// Live LLM via OpenRouter (default model: openai/gpt-4o-mini).
// Every call asks for strict JSON and is validated. Source URLs and dates are
// never taken from the model — they come from the fetched pages — so the model
// cannot invent a source. Compliance lines are appended by code, not the model.

import { z } from "zod";
import type { LookalikeFact, LookalikeJudgeInput, LookalikeJudgement, LookalikePlanInput, LookalikeProfile, LookalikeQuestion } from "../types";
import type { InfluencerInput, InfluencerRole } from "../types";
import type { BrainSuggestInput, MarketEventExtract, SimilarCompanyExtract, BriefingInput, BriefingOutput, CritiqueInput, CritiqueOutput, DraftInput, DraftOutput, ExtractedEvidence, Inference, LLM, ResearchPage } from "../types";
import { briefSchema, claimCheckSchema, insightSchema, planResearchSchema, type BrainStats, type BriefInput, type ClaimToCheck, type PlanResearchInput } from "@/lib/brain/types";
import { fetchJson } from "./http";
import { inferFunction } from "@/lib/pipeline/normalize";
import { seller } from "@/lib/seller";
import { matchPersona } from "@/lib/seller/fit";
import { JOURNEY_STAGES, STAGE_INFO } from "@/lib/journey/stages";
import { companyMarks, plainText } from "@/lib/pipeline/gates";
import { PROFILE_SCHEMA, PROFILE_SYSTEM, profileUserPrompt } from "@/lib/profile/prompts";
import type { ProfileItems, ProfileKind } from "@/lib/profile/types";
import { relevantText } from "./reader";
import { relevanceText } from "@/lib/brain/relevance";
import { connectSchema, emailAuditSchema, investigateSchema, validateSchema, type ConnectInput, type EmailAuditInput, type InvestigateInput, type InvestigationFact, type ValidateInput } from "@/lib/brain/research-types";

const factLine = (f: InvestigationFact) => `${f.id} [${f.key}${f.negative ? ", NEGATIVE" : ""}, ${f.status}, ${f.publisher ?? "?"}, ${f.publishedAt}] ${f.claim}${f.quote ? ` — source says: "${f.quote.slice(0, 240)}"` : ""}`;

const CLASS_RULES =
  "Classes, weakest to strongest: irrelevant (no defensible link to the client's offering), inconclusive (relevant question unresolved), verified_event (a dated event is supported — an event alone is NOT intent), " +
  "relevant_development (the event plausibly relates to a client capability), supported_opportunity (several connected facts support a specific possible need), " +
  "direct_intent (a source EXPLICITLY says the company is evaluating, tendering, selecting or budgeting for this kind of solution). Never upgrade on confidence alone; correlation is not causation.";

const FUNCTIONS = ["data", "it", "procurement", "finance", "sales", "operations", "compliance", "security", "engineering", "marketing", "hr", "executive"] as const;
const NEGATIVE = ["layoffs", "hiring_freeze", "acquired", "bankrupt", "competitor_signed"] as const;

/** What each blocker means. Anything that doesn't meet one exactly is "not_a_blocker" and is dropped. */
export const BLOCKER_DEFINITIONS =
  "bankrupt = insolvency, bankruptcy or liquidation proceedings have been filed or ordered against THIS company (NOT a tax demand, loss, debt, lawsuit, penalty or fine). " +
  "acquired = THIS company has been bought by, or completed a merger into, another company (NOT this company buying someone else). " +
  "competitor_signed = a named vendor offering the same kind of product as the seller has been chosen or deployed by THIS company for that same need (NOT analyst ratings, downgrades, share-price moves or rivals in the company's own market). " +
  "layoffs = company-wide job cuts or a freeze announced because of financial distress (NOT restructuring or merging teams after an acquisition, or trimming one function). " +
  "hiring_freeze = THIS company has stopped hiring company-wide. " +
  "not_a_blocker = any other negative news: stock ratings, tax or legal disputes, quarterly losses, regulatory actions, leadership changes, restructuring. Use it whenever unsure.";

/** Trim to a limit at a word boundary; a trimmed quote is still a run of words from the page. */
const clip = (s: string | null | undefined, n: number) => (s == null ? s : s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, ""));

const BRAIN = (sellerName: string) =>
  `You are the research and strategy brain of an account-based marketing system working for ${sellerName}. ` +
  "You never invent facts: anything about a prospect must come from the numbered facts or pages you are given. " +
  "Label anything you cannot source as a hypothesis. Be specific, short and practical.";

export class OpenRouterLLM implements LLM {
  readonly model: string;
  constructor(private apiKey: string, model = process.env.LLM_MODEL || "openai/gpt-4o-mini") {
    this.model = model;
  }

  private async call(system: string, messages: { role: "user" | "assistant"; content: string }[], maxTokens: number): Promise<string> {
    const res = await fetchJson<{ choices?: { message?: { content?: string } }[] }>("OpenRouter", "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": process.env.APP_URL || "https://abm-chi.vercel.app",
        "X-Title": "ABM Intelligence",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: `${system}\nRespond with a single JSON object only.` }, ...messages],
      }),
      timeoutMs: 45_000,
    });
    return res.choices?.[0]?.message?.content ?? "";
  }

  /** Typed output: validated against the schema; invalid output is retried once with the validation error, then the caller falls back. */
  private async json<T>(schema: z.ZodType<T>, system: string, user: string, maxTokens = 900): Promise<T> {
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: user }];
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this.call(system, messages, maxTokens);
      try {
        return schema.parse(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")));
      } catch (e) {
        lastError = e instanceof z.ZodError ? e.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "not valid JSON";
        messages.push({ role: "assistant", content: text.slice(0, 4000) }, { role: "user", content: `That output was invalid (${lastError}). Return the corrected JSON object only.` });
      }
    }
    throw new Error(`OpenRouter output invalid after retry: ${lastError}`);
  }

  async extractEvidence(pages: ResearchPage[], key: string, known: { id: string; claim: string }[] = [], guideIn?: { company: string; domain: string | null; question?: string }): Promise<ExtractedEvidence[]> {
    if (!pages.length) return [];
    const sp = seller();
    const fixed: Record<string, string> = {
      trigger: `Recent events that create a need for ${sp.name} (${sp.triggers.map((t) => t.label).join("; ")}). One item per distinct event.`,
      negative: `Only explicit negative events about this exact company. kind must be one of: ${NEGATIVE.join(", ")}, not_a_blocker. Definitions: ${BLOCKER_DEFINITIONS}`,
    };
    const q = sp.researchQuestions.find((x) => x.key === key);
    const guide: Record<string, string> = { [key]: fixed[key] ?? q?.extract ?? guideIn?.question ?? q?.question ?? key };
    // Long pages: read the paragraphs that name the company (with context), not just the first screen.
    const marks = guideIn ? companyMarks(guideIn.company, guideIn.domain) : [];
    const body = (p: ResearchPage) => plainText(relevantText(p.text, marks, p.full ? 5_000 : 2_500)).slice(0, p.full ? 5_000 : 2_500);
    if (key === "owner_function") guide[key] += ` value must be one of: ${FUNCTIONS.join(", ")}.`;
    const schema = z.object({
      // Lengths are trimmed afterwards, never a reason to fail the whole answer.
      items: z.array(z.object({ page: z.number().int(), claim: z.string().min(5), quote: z.string().nullable().optional(), value: z.string().nullable().optional(), kind: z.string().nullable().optional(), sameAs: z.string().nullable().optional() })),
    });
    const out = await this.json(
      schema,
      "You extract facts from web pages for B2B account research. Extract only what a page states explicitly — never infer or combine pages. For every item, copy into \"quote\" the exact sentence from the page that supports it, character for character. Write each claim as one short sentence that starts with the company name. If nothing relevant is stated, return {\"items\": []}.",
      `Question: ${key}\nGuidance: ${guide[key] ?? key}\n${known.length ? `\nFacts we already hold (if a page reports the SAME event or value, set "sameAs" to that fact id):\n${known.map((k) => `${k.id}: ${k.claim}`).join("\n")}\n` : ""}\n${pages.map((p, i) => `[page ${i}] ${p.title}\nURL: ${p.url}\nDate: ${p.publishedAt.toISOString().slice(0, 10)}\n${body(p)}`).join("\n\n")}\n\nReturn {"items":[{"page": <page index>, "claim": "...", "quote": "<exact sentence copied from that page>", "value": "... or null", "kind": "${key === "negative" ? "one of the allowed kinds" : "null"}", "sameAs": "<known fact id or null>"}]}`,
    );
    return out.items.slice(0, 8).flatMap((raw) => {
      const it = { ...raw, claim: clip(raw.claim, 240)!, quote: clip(raw.quote, 400), value: clip(raw.value, 120) };
      const p = pages[it.page];
      if (!p) return [];
      const isNegative = key === "negative";
      const kind = isNegative && it.kind && (NEGATIVE as readonly string[]).includes(it.kind) ? it.kind : null;
      if (isNegative && !kind) return [];
      let value = it.value ?? null;
      if (key === "owner_function") value = value && (FUNCTIONS as readonly string[]).includes(value.toLowerCase()) ? value.toLowerCase() : null;
      if (key === "partner_network") value = value?.replace(/[^\d]/g, "") || null;
      const sameAsFactId = it.sameAs && known.some((k) => k.id === it.sameAs) ? it.sameAs : null;
      return [{ key, claim: it.claim, value, sourceUrl: p.url, sourceType: p.sourceType, publishedAt: p.publishedAt, isNegative, negativeKind: kind, sameAsFactId, quote: it.quote ?? null }];
    });
  }

  async infer(facts: { id: string; key: string; claim: string }[]): Promise<Inference[]> {
    if (!facts.length) return [];
    const schema = z.object({ inferences: z.array(z.object({ text: z.string().min(5).max(240), basedOn: z.array(z.string()).min(1) })).max(3) });
    const out = await this.json(
      schema,
      `You help ${seller().name} sellers interpret account research. Make at most 3 cautious inferences about the account's likely needs. Each must list the fact ids it rests on. Never state an inference as certain.`,
      `Facts:\n${facts.map((f) => `${f.id} [${f.key}] ${f.claim}`).join("\n")}\n\nReturn {"inferences":[{"text":"...","basedOn":["<fact id>"]}]}`,
      500,
    );
    return out.inferences;
  }

  async mapRole(title: string | null, ownerFunction: string | null, contactFunction: string | null) {
    // Deterministic from the seller's personas — no model call needed, no cost.
    if (!title) return "unknown" as const;
    const persona = matchPersona(title, seller());
    if (!persona) return this.classifyTitle(title);
    const fn = contactFunction ?? inferFunction(title);
    if (persona.role === "decision_maker" && ownerFunction && fn && !persona.functions.includes(ownerFunction) && fn !== ownerFunction) return "influencer" as const;
    return persona.role;
  }

  async draft(input: DraftInput, attempt: number): Promise<DraftOutput> {
    const linkedin = input.channel === "linkedin";
    const w = input.writing;
    const schema = z.object({
      subject: linkedin ? z.string().max(90).optional().default("") : z.string().min(3).max(90),
      body: z.string().min(linkedin ? 10 : 40).max(1400),
      claims: z.array(z.object({ text: z.string(), factIds: z.array(z.string()) })).max(4),
    });
    const good = w?.examples.filter((e) => e.quality === "good") ?? [];
    const bad = w?.examples.filter((e) => e.quality === "bad") ?? [];
    const knowledge = w
      ? [
          `\n\n${w.playBrief}`,
          w.persona ? `\n\nRECIPIENT PERSONA: ${w.persona.name}\nCares about: ${w.persona.cares.join("; ")}\nTheir words: ${w.persona.language.join(", ")}\nAvoid: ${w.persona.avoid.join("; ")}\nOpening that lands: ${w.persona.opener}` : "",
          w.norms.length ? `\n\nMARKET NORMS:\n- ${w.norms.join("\n- ")}` : "",
          w.marketFacts.length ? `\n\nMARKET FACTS you may use (at most one; name the source; never present it as a fact about the prospect):\n- ${w.marketFacts.map((f) => `${f.text} (${f.attribution})`).join("\n- ")}` : "",
          good.length ? `\n\nSTYLE EXAMPLES — imitate their shape, tone and length; never copy their details, placeholders, names or numbers:\n${good.map((e) => `---\n${e.subject ? `Subject: ${e.subject}\n` : ""}${e.body}\n(Why it works: ${e.why})`).join("\n")}` : "",
          w.references?.length ? `\n\nREFERENCE KNOWLEDGE (from the knowledge base; use only what fits this person):${w.references.map((r) => `\n--- ${r.approved ? "APPROVED — may be stated about the seller" : "BACKGROUND — for understanding only; never state it as a fact or quote its numbers"} · ${r.kind} · ${r.title}\n${r.text}`).join("")}` : "",
          bad.length ? `\n\nDON'T WRITE LIKE THIS:\n${bad.map((e) => `---\n${e.body}\n(Why it fails: ${e.why})`).join("\n")}` : "",
        ].join("")
      : "";
    const out = await this.json(
      schema,
      [
        `You write ${linkedin ? "LinkedIn messages" : "B2B outreach emails"} for ${input.seller.name}. ${(input.tone?.length ? input.tone : ["Plain, specific, under 120 words, no hype, no fake familiarity"]).join(". ")}.`,
        w ? `Follow the PLAY, the RECIPIENT PERSONA and the MARKET NORMS in the message below. The play's limits are checked by code; a message that breaks them is rejected.` : "",
        linkedin ? "This is a LinkedIn message: no subject line, no signature, no email footer, no links." : "",
        input.bannedClaims?.length ? `Never claim: ${input.bannedClaims.join("; ")}.` : "",
        "Rules:",
        "1. Every sentence about the prospect must come from the FACTS list and be listed in claims with that fact's id.",
        "2. Do not mention anything about the prospect that is not in FACTS. Do not guess numbers.",
        input.interest ? `WEBSITE INTEREST: ${input.interest}. Use it only to choose which pain, use case or proof point to lead with. Never mention or hint that they visited the website, read a page or looked at pricing.` : "",
        "3. Use the SELLER PITCH for what the seller does; you may shorten it but must not add new claims.",
        `4. End with one ask in the style the PLAY describes (the seller CTA is one way to say it). ${linkedin ? "No signature." : "Do not add a signature, address or unsubscribe line — the system appends them."}`,
        "5. If an ANGLE is given, build the email around that pain and capability for this person's role; the pain is a hypothesis, so phrase it as a question or 'teams like yours often…', never as a fact about them.",
        attempt > 1 && !input.revise ? "6. A previous attempt failed fact-checking: cite a fact id for every prospect claim and keep each claim's wording close to the fact." : "",
        "7. Open with the most specific converging signal from SIGNALS (a running LinkedIn conversation beats everything). Anything you say about the prospect must still cite a FACT id; a LinkedIn conversation may be referred to as 'our conversation on LinkedIn'. Never use stock phrases (hope this finds you well, touch base, I came across, streamline your operations, unlock potential).",
        input.revise ? "6. You are REWRITING the previous version below. Fix every listed issue, keep what works, and keep every remaining claim tied to a fact id." : "",
      ].join("\n"),
      `Recipient: ${input.firstName ?? "there"}${input.title ? `, ${input.title}` : ""} at ${input.company}\nStep ${input.stepOrder}: ${input.instruction}\n\nFACTS:\n${input.facts.map((f) => `${f.id} [${f.key}] ${f.claim}`).join("\n")}${input.angle ? `\n\nANGLE for a ${input.angle.persona}: pain (hypothesis) = ${input.angle.pain}; ${input.seller.name} capability = ${input.angle.capability}${input.angle.proofPoint ? `; proof point = ${input.angle.proofPoint}` : ""}` : ""}${input.learnings?.length ? `\n\nWHAT HAS WORKED BEFORE (style advice only):\n- ${input.learnings.join("\n- ")}` : ""}${input.signals?.length ? `\n\nSIGNALS (converging, strongest first):\n- ${input.signals.join("\n- ")}` : ""}\n\nSELLER PITCH: ${input.seller.pitch}\nCTA: ${input.seller.cta}${knowledge}${input.revise ? `\n\nPREVIOUS VERSION\nSubject: ${input.revise.subject}\n${input.revise.body.split("\n\n" + input.sender.name)[0]}\n\nISSUES TO FIX:\n- ${input.revise.issues.join("\n- ")}` : ""}\n\nReturn {"subject":"${linkedin ? "" : "..."}","body":"...","claims":[{"text":"<sentence from body>","factIds":["<id>"]}]}`,
      700,
    );
    if (linkedin) return { subject: "", body: out.body.trim(), angle: input.facts[0]?.key ?? null, claims: out.claims };
    const footer = `\n\n${input.sender.name}\n${input.sender.company} · ${input.sender.address}\n\nReply "unsubscribe" and I won't email again.`;
    return { subject: out.subject, body: out.body.trim() + footer, angle: input.facts[0]?.key ?? null, claims: out.claims };
  }

  async critiqueDraft(input: CritiqueInput): Promise<CritiqueOutput> {
    const schema = z.object({ pass: z.boolean(), issues: z.array(z.string().min(3).max(240)).max(6), strengths: z.array(z.string().max(200)).max(4) });
    return this.json(
      schema,
      "You are a strict reviewer of B2B cold emails. Judge only the email given. Fail it for: tone rules broken, any banned claim, a statement about the prospect presented as fact when it is a guess, not relevant to the recipient's role or the stated angle, or longer than 150 words before the signature. Each issue must say exactly what to change.",
      `Recipient: ${input.recipientTitle ?? "unknown role"} at ${input.company}${input.persona ? `\nPersona: ${input.persona}` : ""}\nAngle: ${input.angle ?? "none"}\nTone rules: ${input.tone.join("; ")}\nBanned claims: ${input.bannedClaims.join("; ") || "none"}${input.play ? `\n\nThe message must follow this play (judge structure, ask and fit for the persona; length is checked separately):\n${input.play}` : ""}\n\nSubject: ${input.subject}\n${input.body}\n\nReturn {"pass": true|false, "issues": ["..."], "strengths": ["..."]}`,
      500,
    );
  }

  async classifyReply(text: string) {
    const schema = z.object({ class: z.enum(["positive", "objection", "not_now", "unsubscribe", "wrong_person", "out_of_office", "needs_human"]) });
    const out = await this.json(
      schema,
      "Classify a reply to a B2B sales email. positive = wants to talk or learn more; objection = pushes back (has a tool, no budget, not a priority); not_now = timing; unsubscribe = asks to stop; wrong_person = redirects to someone else; out_of_office = auto-reply; needs_human = unclear or anything else.",
      `Reply:\n"""${text.slice(0, 3000)}"""\n\nReturn {"class":"..."}`,
      50,
    );
    return out.class;
  }

  async briefing(input: BriefingInput): Promise<BriefingOutput> {
    const schema = z.object({ whyNow: z.string().max(400), facts: z.array(z.object({ text: z.string(), factId: z.string() })).max(5) });
    const out = await this.json(
      schema,
      `Write a short sales handoff briefing for a ${seller().name} rep. Use only the facts given and cite each by id.`,
      `Company: ${input.company}\nTrigger: ${input.trigger}\nFacts:\n${input.facts.map((f) => `${f.id}: ${f.claim}`).join("\n")}\nWho engaged: ${input.engaged.map((e) => `${e.name} (${e.title ?? "?"}): ${e.signals.join(", ")}`).join("; ") || "none"}\n\nReturn {"whyNow":"...","facts":[{"text":"...","factId":"<id>"}]}`,
      500,
    );
    return { whyNow: out.whyNow, facts: out.facts, unknowns: input.unknowns, engaged: input.engaged };
  }

  private async classifyTitle(title: string) {
    const sp = seller();
    const schema = z.object({ role: z.enum(["decision_maker", "champion", "influencer", "budget_owner", "unknown"]) });
    try {
      const out = await this.json(
        schema,
        `Map a job title to its buying role for a ${sp.name} purchase. Roles:\n${sp.personas.map((p) => `${p.role}: ${p.titles.slice(0, 6).join(", ")} — ${p.why}`).join("\n")}\nUse "unknown" when the title is unrelated.`,
        `Title: ${title}\nReturn {"role":"..."}`,
        40,
      );
      return out.role;
    } catch {
      return "unknown" as const;
    }
  }

  // ── The research engine ──

  async investigate(input: InvestigateInput) {
    return this.json(
      investigateSchema,
      `${BRAIN(input.relevance.client)} You investigate one company like an analyst. Only follow developments with a defensible potential link to the client's offering; never collect unrelated news. ` +
        "Loop: observe a sourced event (never call an event intent) → hypothesise a connection to a client use case, stating assumptions → ask the questions whose answers would MOST change the commercial conclusion, " +
        "including questions that could DISPROVE it (an incumbent supplier, the programme already finished, the change not touching the client's processes) → connect by shared programme, team, geography, timing, technology or owner. " +
        "Each query must name the company in quotes and be specific (programme names, places, roles, dates). Use different wording and source types than queries already asked. Set done=true when more searching is unlikely to change the conclusion.",
      [
        `COMPANY: ${input.company.name} (${input.company.domain ?? "no domain"}) · ${input.company.industry ?? "industry unknown"} · ${input.company.employees ?? "?"} employees · ${input.company.country ?? "?"}`,
        relevanceText(input.relevance),
        `FACTS (id [key, status, publisher, date] claim — source says):
${input.facts.map(factLine).join("\n") || "none yet"}`,
        `HYPOTHESES SO FAR:
${input.hypotheses.map((h) => `${h.id} [${h.classification}/${h.status}] ${h.text} (support: ${h.supportIds.join(",") || "none"}; counter: ${h.counterIds.join(",") || "none"})`).join("\n") || "none"}`,
        `QUERIES ALREADY ASKED (do not repeat): ${input.asked.join(" | ") || "none"}`,
        `Round ${input.round}. Propose up to ${input.maxQuestions + 2} questions; value 5 = the answer could flip the conclusion, 1 = nice to know.`,
        `Return {"hypotheses":[{"ref":"<existing id or new>","text":"...","useCase":"<use case key or null>","assumptions":["..."],"supportIds":["<fact id>"],"counterIds":["<fact id>"]}],"questions":[{"question":"...","query":"...","purpose":"baseline|confirm|disconfirm|connect|discover","hypothesisRef":"<id or null>","value":1-5,"why":"what the answer decides"}],"done":false,"doneWhy":"..."}`,
      ].join("\n\n"),
      1400,
    );
  }

  async connectEvidence(input: ConnectInput) {
    return this.json(
      connectSchema,
      `${BRAIN(input.relevance.client)} Connect the evidence about one company into typed links and classify each hypothesis honestly. ${CLASS_RULES} ` +
        "Every link needs a rationale and the fact ids it rests on; a link you cannot support with fact ids must have an empty evidenceIds list (it will be shown as an assumption). Name credible alternative explanations.",
      [
        `COMPANY: ${input.company.name} (${input.company.domain ?? "?"})`,
        relevanceText(input.relevance),
        `FACTS:
${input.facts.map(factLine).join("\n") || "none"}`,
        `HYPOTHESES:
${input.hypotheses.map((h) => `${h.id}: ${h.text} (use case ${h.useCase ?? "?"}; support ${h.supportIds.join(",") || "none"}; counter ${h.counterIds.join(",") || "none"}; assumptions: ${h.assumptions.join("; ") || "none"})`).join("\n")}`,
        `Refs: fact:<id>, capability:<use case key>, hypothesis:<id>, entity:<name>. Relations: announced_by, part_of, responsible_for, may_create_need_for, contradicts, supported_by, same_programme, same_owner, same_timeframe.`,
        `Return {"hypotheses":[{"id":"...","classification":"...","useCase":"<key or null>","rationale":"...","supportIds":[],"counterIds":[],"alternatives":["..."]}],"links":[{"hypothesisId":"<id or null>","from":"fact:<id>","relation":"may_create_need_for","to":"capability:<key>","rationale":"...","evidenceIds":["<fact id>"]}]}`,
      ].join("\n\n"),
      1600,
    );
  }

  async auditEmail(input: EmailAuditInput) {
    return this.json(
      emailAuditSchema,
      "You audit a B2B email sentence by sentence. For EVERY sentence say whether it states something about the prospect company or person (aboutProspect). If it does: kind=fact when stated as true — then it must be fully supported by the given facts and their source quotes (no added numbers, names, dates, scope or certainty); kind=hypothesis when it is a possible need or pain — then it must be phrased as a question or a possibility (phrasedAsHypothesis). Sentences about the sender's own product are kind=seller.",
      `Company: ${input.company}\n\nFACTS:\n${input.facts.map((f) => `${f.id}: ${f.claim}${f.quote ? ` (source says: "${f.quote}")` : ""}`).join("\n") || "none"}\n\nHYPOTHESES (may only be raised as questions/possibilities):\n${input.hypotheses.join("\n") || "none"}\n\nEMAIL:\n${input.body}\n\nReturn {"sentences":[{"text":"...","aboutProspect":true,"kind":"fact|hypothesis|seller|other","supported":true,"factIds":["..."],"phrasedAsHypothesis":false,"reason":"..."}]}`,
      1200,
    );
  }

  async validateResearch(input: ValidateInput) {
    return this.json(
      validateSchema,
      "You are an independent research validator. You did not do this research and you are not trying to sell anything. For each hypothesis: reread every supporting quote and passage, and check (1) the passage is about THIS company and this time period, " +
        "(2) each claim says no more than its quote, (3) linked events really share a programme, owner, timeframe or dependency — not just appear together, (4) copies of one press release (same fingerprint) are one source, " +
        "(5) the evidence is fresh, (6) 'direct_intent' is explicitly stated by a source. Offer credible alternative explanations. Verdicts: upheld, downgrade (give the lower class), reject (not supported), " +
        `needs_research (give up to 3 precise repair questions with queries naming the company). You may only keep or LOWER a class. ${CLASS_RULES}`,
      `COMPANY: ${input.company.name} (${input.company.domain ?? "?"}) · today ${input.today}\n\n${input.hypotheses.map((h) => `HYPOTHESIS ${h.id} [${h.classification}]: ${h.text}\nRationale: ${h.rationale ?? "—"}\nSUPPORT:\n${h.support.map((s) => `- ${s.id} (${s.publisher ?? "?"}, ${s.publishedAt}, fp ${s.fingerprint ?? "—"}): ${s.claim}\n  quote: "${s.quote ?? "—"}"\n  passage: ${s.passage?.slice(0, 700) ?? "—"}`).join("\n") || "- none"}\nCOUNTER:\n${h.counter.map((c) => `- ${c.id}: ${c.claim}${c.quote ? ` ("${c.quote}")` : ""}`).join("\n") || "- none"}\nLINKS:\n${h.links.map((l) => `- ${l.from} ${l.relation} ${l.to} [${l.evidenceIds.join(",") || "no evidence"}]: ${l.rationale}`).join("\n") || "- none"}`).join("\n\n")}\n\nReturn {"results":[{"hypothesisId":"...","verdict":"upheld|downgrade|reject|needs_research","classification":"...","issues":["..."],"alternatives":["..."],"repairQuestions":[{"question":"...","query":"..."}]}]}`,
      1600,
    );
  }

  // ── The brain ──

  async planResearch(input: PlanResearchInput) {
    return this.json(
      planResearchSchema,
      `${BRAIN(input.seller.name)} You are planning web research on one target company. Each search costs credits, so ask each question once, with the engine best suited to it, and write a precise query that includes the company name in quotes.`,
      [
        `COMPANY: ${input.company.name} (${input.company.domain ?? "no domain"}) · ${input.company.industry ?? "industry unknown"} · ${input.company.employees ?? "?"} employees · ${input.company.country ?? "?"} · stack: ${input.company.technologies.join(", ") || "unknown"}`,
        `FIT ${input.company.fitScore ?? "?"}/100: ${input.company.fitReasons.join("; ")}`,
        `${input.seller.name.toUpperCase()}: ${input.seller.summary}`,
        `USE CASES: ${input.seller.useCases.map((u) => `${u.key} (${u.pains})`).join(" | ")}`,
        `BUYING TRIGGERS: ${input.seller.triggers.map((t) => t.label).join("; ")}`,
        `ALREADY KNOWN: ${input.known.map((k) => `[${k.key}/${k.status}] ${k.claim}`).join(" | ") || "nothing"}`,
        input.imported ? `FROM THE CLIENT'S IMPORT (treat as given; do not search for these again): systems: ${input.imported.technologies.join(", ") || "—"}; keywords: ${input.imported.keywords.join(", ") || "—"}; notes: ${input.imported.notes ?? "—"}; LinkedIn conversations: ${input.imported.conversations.map((c) => `${c.name} (${c.title ?? "?"}) — ${c.stage}${c.lastReply ? `: "${c.lastReply.slice(0, 120)}"` : ""}`).join(" | ") || "none"}. Use the keywords to make queries specific to what this company does.` : "",
        `QUESTIONS TO PLAN (keep every high-importance one):\n${input.candidates.map((c) => `- ${c.key} (${c.importance}): ${c.question}`).join("\n")}`,
        `ENGINES: ${input.engines.join(", ")}. exa = semantic web search with full page text (best for company pages, stack, network size); tavily = news search with dates (best for recent events); serp = Google News/Google (best for very recent news and second opinions).${Object.keys(input.routing).length ? ` Learned best engine per question: ${Object.entries(input.routing).map(([k, v]) => `${k}→${v}`).join(", ")}.` : ""}`,
        `Return {"hypotheses":["what you expect to find and why it would matter to ${input.seller.name}"],"questions":[{"key":"<question key>","query":"<search query>","engine":"<one of the engines>","why":"<what the answer decides>"}],"skip":[{"key":"...","reason":"..."}]}`,
      ].join("\n\n"),
      900,
    );
  }

  async accountBrief(input: BriefInput) {
    return this.json(
      briefSchema,
      `${BRAIN(input.seller.name)} Connect the facts about this company to ${input.seller.name}'s use cases. A pain point must rest on fact ids; the pain itself is an inference and must be worded as one. Give each buying role its own angle so colleagues at the same company do not receive the same message.`,
      [
        `COMPANY: ${input.company.name} · ${input.company.industry ?? "?"} · ${input.company.employees ?? "?"} employees · ${input.company.country ?? "?"} · stack: ${input.company.technologies.join(", ") || "unknown"}`,
        `FIT ${input.company.fitScore ?? "?"}/100: ${input.company.fitReasons.join("; ")}`,
        `FACTS:\n${input.facts.map((f) => `${f.id} [${f.key}, ${f.status}, ${f.sourceType}] ${f.claim}`).join("\n") || "none"}`,
        `INFERENCES: ${input.inferences.join(" | ") || "none"}`,
        input.investigation?.length ? `INVESTIGATION (class decides the wording you may use — verified_event: "the company announced X"; relevant_development: "X may be relevant to Y"; supported_opportunity: "evidence suggests a potential need for Y"; direct_intent: "the company is evaluating Y" only if validated; only status=validated conclusions may drive a strong verdict):\n${input.investigation.map((h) => `- [${h.classification}/${h.status}] ${h.text} (facts ${h.supportIds.join(",") || "none"})${h.note ? ` — validator: ${h.note.slice(0, 160)}` : ""}`).join("\n")}` : "INVESTIGATION: no client-relevant hypothesis yet",
        `NEGATIVE NEWS: ${input.negatives.join(" | ") || "none found"}`,
        `UNKNOWN: ${input.unknowns.join(", ") || "nothing"}`,
        `RESEARCH HYPOTHESES: ${input.hypotheses.join(" | ") || "none"}`,
        input.intent ? `INTENT SIGNALS (score ${input.intent.score}, ${input.intent.level}; independent families converging is what matters): ${input.intent.signals.map((s) => `[${s.family}] ${s.label}`).join(" | ") || "none"}. Build "why now" from the strongest CONVERGING signals and name them specifically; if only one weak family exists, say the timing is unproven.` : "",
        input.imported ? `FROM THE CLIENT'S IMPORT: systems ${input.imported.technologies.join(", ") || "—"}; keywords ${input.imported.keywords.join(", ") || "—"}; team notes: ${input.imported.notes ?? "—"}; LinkedIn conversations already running: ${input.imported.conversations.map((c) => `${c.name} (${c.title ?? "?"}) — ${c.stage}${c.lastReply ? `: "${c.lastReply.slice(0, 120)}"` : ""}`).join(" | ") || "none"}. If a conversation is running, the next best action must build on it.` : "",
        `${input.seller.name.toUpperCase()} PRODUCTS: ${input.seller.products.map((p) => `${p.name}: ${p.what}${p.useCases?.length ? ` (serves: ${p.useCases.join(", ")})` : ""}`).join(" | ")}. In each pain point's capability, name the product that serves its use case when one is listed.`,
        `USE CASES (useCase must be one of these keys): ${input.seller.useCases.map((u) => `${u.key} — pains: ${u.pains}; outcome: ${u.outcome}`).join(" | ")}`,
        `PERSONAS: ${input.seller.personas.map((p) => `${p.role}: ${p.titles.slice(0, 4).join(", ")} — ${p.why}`).join(" | ")}`,
        `PROOF POINTS: ${input.seller.proofPoints.join(" | ")}`,
        `COMPETITORS: ${input.seller.competitors.map((c) => `${c.name}: ${c.angle}`).join(" | ")}`,
        input.learnings.length ? `WHAT HAS WORKED BEFORE: ${input.learnings.join(" | ")}` : "",
        `Return {"verdict":"strong|moderate|weak","verdictWhy":"...","whyNow":{"text":"...","factIds":["..."]} or null,"painPoints":[{"pain":"...","factIds":["..."],"useCase":"<key>","capability":"<what ${input.seller.name} does about it>","confidence":"high|medium|low"}],"personaAngles":[{"role":"decision_maker|champion|influencer|budget_owner","angle":"...","painIndex":0}],"hypotheses":["to confirm in discovery"],"risks":["..."],"nextBestAction":"..."}`,
      ].filter(Boolean).join("\n\n"),
      1400,
    );
  }

  async checkClaims(claims: ClaimToCheck[]) {
    if (!claims.length) return [];
    const out = await this.json(
      claimCheckSchema,
      "You are a strict fact-checker. For each claim, decide whether the cited facts fully support it. Unsupported = adds a number, date, name, scope or certainty the facts do not state, or misreads them. Paraphrase is fine.",
      `${claims.map((c, i) => `CLAIM ${i}: ${c.text}\nCITED FACTS:\n${c.facts.map((f) => `- ${f.claim}`).join("\n") || "- none"}`).join("\n\n")}\n\nReturn {"results":[{"index":0,"supported":true,"reason":"..."}]}`,
      400,
    );
    return out.results;
  }

  async insights(stats: BrainStats) {
    return this.json(
      insightSchema,
      `${BRAIN(seller().name)} Review the performance numbers and say what is working, what is not, and what to change. Only draw a conclusion from a group with at least ${stats.minSample} examples; otherwise say there is not enough data. Each item's evidence must quote the numbers it rests on.`,
      `STATS:\n${JSON.stringify(stats)}\n\nReturn {"headline":"...","working":[{"text":"...","evidence":"..."}],"notWorking":[{"text":"...","evidence":"..."}],"recommendations":[{"area":"research|messaging|targeting|process","text":"..."}]}`,
      900,
    );
  }

  async classifyJourneyReply(text: string, context: { company: string; title: string | null; stage: string }) {
    const stages = JOURNEY_STAGES.map((k) => `${k} = ${STAGE_INFO[k].label}: ${STAGE_INFO[k].useWhen}`).join("\n");
    const schema = z.object({ stage: z.enum(JOURNEY_STAGES), reason: z.string().max(200), nextAction: z.string().max(200) });
    return this.json(
      schema,
      `You classify a prospect's reply to ${seller().name}'s LinkedIn or email outreach. The reply's MEANING sets the stage. Choose exactly one stage:\n${stages}\nExamples: "Hi, nice to connect" → replied_neutral; "Please share more details" → details_requested; "Yes, we are interested" → interested; "I will check and inform you" → nurture; "We do not have a current requirement" → not_interested; "Please contact our production head" → referred; "I no longer work there" → disqualified. When unsure, choose replied_neutral.`,
      `Prospect: ${context.title ?? "unknown title"} at ${context.company}. Current stage: ${context.stage}.\nReply:\n"""${text.slice(0, 3000)}"""\n\nReturn {"stage":"<stage key>","reason":"<one short sentence>","nextAction":"<the next step for the sender>"}`,
      150,
    );
  }

  async proposeInfluencers(input: InfluencerInput): Promise<InfluencerRole[]> {
    if (!input.facts.length) return [];
    const schema = z.object({ roles: z.array(z.object({ title: z.string().min(4).max(80), searchTitles: z.array(z.string().min(3).max(80)).min(1).max(5), group: z.string(), why: z.string().min(20).max(300), factIds: z.array(z.string()).min(1).max(4) })).max(6) });
    const out = await this.json(
      schema,
      "You plan multi-threaded account-based selling. Given what is known about a company, name 3 or 4 people who are NOT the obvious executive buyers (never CEO, CFO, CIO, CTO, COO, MD, founder or chairman) but whose daily work the known facts directly affect, so they will shape or slow the decision: e.g. the lead of a programme the facts mention, the owner of a process the facts show under strain, internal audit when the facts show a control issue, a plant or regional head when the facts show expansion. " +
        "Every role MUST be justified by one or more of the given fact ids, and \"why\" must say concretely how that fact touches this person's work. Never invent facts. Skip roles the company already has mapped. group must be one of the given group keys. searchTitles = 2-5 job titles as people write them on LinkedIn.",
      `Company: ${input.company}${input.industry ? ` (${input.industry})` : ""}\nWhat we sell: ${input.offering}${input.useCase ? `\nLeading with: ${input.useCase}` : ""}\n\nFacts:\n${input.facts.map((f) => `${f.id}: ${f.claim}`).join("\n")}\n${input.conclusions.length ? `\nConclusions:\n${input.conclusions.map((c) => `- ${c}`).join("\n")}\n` : ""}\nAlready mapped:\n${input.existing.map((e) => `- ${e.title} (${e.role})`).join("\n") || "- nobody"}\n\nGroup keys: ${input.groups.join(", ")}\n\nReturn {"roles":[{"title":"...","searchTitles":["..."],"group":"...","why":"...","factIds":["..."]}]}`,
      900,
    );
    return out.roles;
  }

  async extractProfile<K extends ProfileKind>(kind: K, pages: ResearchPage[], company: { name: string; domain: string | null }): Promise<ProfileItems[K]> {
    if (!pages.length) return [] as unknown as ProfileItems[K];
    const marks = companyMarks(company.name, company.domain);
    // Long reports: read the paragraphs that name the company (and the numbers around them).
    const read = pages.map((p) => ({ ...p, text: plainText(relevantText(p.text, marks, p.full ? 6_000 : 3_000)) }));
    const out = await this.json(PROFILE_SCHEMA[kind] as unknown as z.ZodType<{ items: unknown[] }>, PROFILE_SYSTEM[kind], profileUserPrompt(kind, company.name, company.domain, read, 6_000), 1800);
    return out.items as ProfileItems[K];
  }

  async extractFirmographics(pages: ResearchPage[], company: string) {
    if (!pages.length) return null;
    const schema = z.object({ page: z.number().int().nullable(), industry: z.string().max(80).nullable(), employees: z.number().nullable(), country: z.string().max(60).nullable() });
    const out = await this.json(
      schema,
      "You read company profile pages and return the company's industry, employee count and headquarters country. Use only what a page states about THIS company; null when not stated. employees = one number (midpoint of a range).",
      `Company: ${company}\n\n${pages.map((p, i) => `[page ${i}] ${p.title}\nURL: ${p.url}\n${p.text.slice(0, 1500)}`).join("\n\n")}\n\nReturn {"page": <index of the page used or null>, "industry": "...", "employees": 1234, "country": "..."}`,
      200,
    );
    if (out.page == null || !pages[out.page]) return null;
    return { industry: out.industry, employees: out.employees, country: out.country, page: out.page };
  }

  async extractMarketEvents(pages: ResearchPage[]): Promise<MarketEventExtract[]> {
    if (!pages.length) return [];
    const sp = seller();
    const schema = z.object({ items: z.array(z.object({ page: z.number().int(), company: z.string().min(2).max(120), industry: z.string().max(80).nullable(), triggerKey: z.string().max(40), claim: z.string().max(300), quote: z.string().max(400) })).max(30) });
    const out = await this.json(
      schema,
      `You read news pages and list companies that had a buying event relevant to ${sp.name}. Events: ${sp.triggers.map((t) => `${t.key} = ${t.label}`).join("; ")}. Only companies a page names explicitly; never the publisher, a consultant or a vendor. quote = exact words copied from the page that show the event. triggerKey = one of the keys above, "hiring" for a job post or hiring drive for the roles that own this problem, or "other". industry = the company's industry if the page says or makes it obvious, else null.`,
      `${pages.map((p, i) => `[page ${i}] ${p.title}\nURL: ${p.url}\n${p.text.slice(0, 1800)}`).join("\n\n")}\n\nReturn {"items": [{"page": 0, "company": "...", "industry": "...", "triggerKey": "...", "claim": "...", "quote": "..."}]}`,
      1500,
    );
    return out.items.filter((x) => pages[x.page]);
  }

  async extractSimilarCompanies(pages: ResearchPage[], seed: { name: string; industry: string | null }): Promise<SimilarCompanyExtract[]> {
    if (!pages.length) return [];
    const schema = z.object({ items: z.array(z.object({ page: z.number().int(), name: z.string().min(2).max(120), domain: z.string().max(120).nullable(), reason: z.string().max(160), quote: z.string().max(400) })).max(40) });
    const out = await this.json(
      schema,
      `You read web pages and list real companies that are similar to ${seed.name}${seed.industry ? ` (${seed.industry})` : ""}: direct competitors or peers in the same business. Only companies a page names explicitly. Never ${seed.name} itself, never publishers, consultants, investors or software vendors serving them. quote = exact words copied from the page that name the company. reason = a few words on why it is similar.`,
      `${pages.map((p, i) => `[page ${i}] ${p.title}\nURL: ${p.url}\n${p.text.slice(0, 1800)}`).join("\n\n")}\n\nReturn {"items": [{"page": 0, "name": "...", "domain": null, "reason": "...", "quote": "..."}]}`,
      1500,
    );
    return out.items.filter((x) => pages[x.page]);
  }

  // ── Lookalikes ──

  async profileCompany(pages: ResearchPage[], company: string, offering: string): Promise<LookalikeProfile | null> {
    if (!pages.length) return null;
    const t = z.string().max(400);
    const schema = z.object({ found: z.boolean(), summary: t, businessModel: t, operations: t, industry: z.string().max(80).nullable(), customers: t, scale: t, offeringFit: t });
    const out = await this.json(
      schema,
      `You profile a company from its own and reputable pages, to find other companies like it. Describe what it actually does, not its marketing: how it makes money (businessModel), how it runs (operations: plants, distribution, branches, field teams, supply chain, systems), its industry, who its customers are, its scale (employees, revenue, locations, only if stated) and why it would buy what this seller offers: ${offering}. Use only what the pages state; write "unknown" for anything not stated. found=false if the pages are not about this company.`,
      `Company: ${company}\n\n${pages.map((p, i) => `[page ${i}] ${p.title}\nURL: ${p.url}\n${p.text.slice(0, 2500)}`).join("\n\n")}\n\nReturn {"found": true, "summary": "...", "businessModel": "...", "operations": "...", "industry": "...", "customers": "...", "scale": "...", "offeringFit": "..."}`,
      900,
    );
    if (!out.found) return null;
    const { found: _found, ...profile } = out;
    void _found;
    return profile;
  }

  async planLookalike(input: LookalikePlanInput): Promise<{ questions: LookalikeQuestion[]; done: boolean; why: string }> {
    const dim = z.enum(["business_model", "operations", "industry", "scale", "offering", "intent"]);
    const schema = z.object({ done: z.boolean(), why: z.string().max(300), questions: z.array(z.object({ question: z.string().max(200), why: z.string().max(200), query: z.string().max(200), engine: z.enum(["exa", "tavily"]), dimension: dim })).max(4) });
    const facts = input.facts.length ? input.facts.map((f) => `- [${f.dimension}${f.verified ? ", verified" : ", one source"}] ${f.claim}`).join("\n") : "- nothing yet";
    return this.json(
      schema,
      `You investigate whether ${input.company.name} is genuinely like ${input.seed.name} (a company that buys from the seller) and whether it may be ready to buy. Do not match on keywords: compare business model, operations, industry, scale and relevance to the offering, and look for real buying intent (expansion, new plants or markets, system changes, leadership hires, hiring for the relevant team, regulation). Each round, ask the 1-4 questions whose answers would most change the conclusion, including ones that could DISPROVE the match. Never repeat a question already asked. Prefer engine "exa" for what a company is and does, "tavily" for recent news and events. query = a web search query naming the company. done=true when the evidence is enough to judge confidently, or further searching is unlikely to change it.${input.note ? " A person asked you to look into something specific: answer that first." : ""}`,
      `Seller offering: ${input.offering}\nMust share: ${input.focus.join("; ") || "(not set)"}\nRule out: ${input.avoid.join("; ") || "(not set)"}\n\n${input.seed.name} (the reference): ${input.seed.summary}\nBusiness model: ${input.seed.businessModel}\nOperations: ${input.seed.operations}\nIndustry: ${input.seed.industry ?? "unknown"}\nCustomers: ${input.seed.customers}\nScale: ${input.seed.scale}\nWhy it buys: ${input.seed.offeringFit}\n\nCandidate: ${input.company.name}${input.company.domain ? ` (${input.company.domain})` : ""}\nKnown so far:\n${facts}\n\nAlready asked:\n${input.asked.map((q) => `- ${q}`).join("\n") || "- nothing"}\n${input.note ? `\nPerson's request: ${input.note}\n` : ""}\nRound ${input.round} of ${input.maxRounds}. Return {"done": false, "why": "...", "questions": [{"question": "...", "why": "...", "query": "...", "engine": "exa", "dimension": "operations"}]}`,
      700,
    );
  }

  async extractLookalikeFacts(pages: ResearchPage[], company: string, question: LookalikeQuestion): Promise<LookalikeFact[]> {
    if (!pages.length) return [];
    const schema = z.object({ items: z.array(z.object({ page: z.number().int(), claim: z.string().max(240), quote: z.string().max(400), dimension: z.enum(["business_model", "operations", "industry", "scale", "offering", "intent"]) })).max(8) });
    const out = await this.json(
      schema,
      `You read pages and list facts about ${company} that answer the question. Only facts a page states about THIS company (never a competitor, the publisher or a vendor). claim = one plain sentence. quote = the exact words copied from the page that support it. dimension = what the fact is about. Return no items if the pages don't answer it.`,
      `Question: ${question.question} (${question.dimension})\n\n${pages.map((p, i) => `[page ${i}] ${p.title}\nURL: ${p.url}\n${p.text.slice(0, 2500)}`).join("\n\n")}\n\nReturn {"items": [{"page": 0, "claim": "...", "quote": "...", "dimension": "${question.dimension}"}]}`,
      900,
    );
    return out.items.filter((x) => pages[x.page]);
  }

  async judgeLookalike(input: LookalikeJudgeInput): Promise<LookalikeJudgement> {
    const n = z.number().min(0).max(100);
    const schema = z.object({ dims: z.object({ business_model: n, operations: n, industry: n, scale: n, offering: n }), readiness: z.enum(["ready", "emerging", "early", "none"]), readinessScore: n, reasons: z.array(z.string().max(220)).max(5), concerns: z.array(z.string().max(220)).max(4), avoidHit: z.string().max(160).nullable() });
    const facts = input.facts.map((f) => `- [${f.dimension}${f.verified ? ", verified" : ", one source"}] ${f.claim}`).join("\n") || "- no facts found";
    return this.json(
      schema,
      `You judge, from the facts only, how closely ${input.company.name} resembles ${input.seed.name} and how ready it is to buy the seller's offering. Score each dimension 0-100; with no facts on a dimension score it 30 (unknown), never higher. Facts from one source count less than verified ones. readiness: ready = recent, verified buying events tied to the offering; emerging = some relevant change underway; early = good fit but no current event; none = evidence suggests no need. reasons = up to 5 short sentences a salesperson can check, each grounded in a fact. concerns = what weakens the case. avoidHit = the rule-out item it matches, or null.`,
      `Seller offering: ${input.offering}\nMust share: ${input.focus.join("; ") || "(not set)"}\nRule out: ${input.avoid.join("; ") || "(not set)"}\n\nReference ${input.seed.name}: ${input.seed.summary} | model: ${input.seed.businessModel} | operations: ${input.seed.operations} | industry: ${input.seed.industry ?? "unknown"} | scale: ${input.seed.scale}\n\nCandidate ${input.company.name}:\n${facts}\n\nReturn {"dims": {"business_model": 0, "operations": 0, "industry": 0, "scale": 0, "offering": 0}, "readiness": "early", "readinessScore": 0, "reasons": ["..."], "concerns": ["..."], "avoidHit": null}`,
      900,
    );
  }

  async suggestBrainItems(input: BrainSuggestInput): Promise<Record<string, string>[]> {
    if (!input.context.length) return [];
    const schema = z.object({ items: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v.join(", ") : String(v))))).max(input.single ? 1 : 8) });
    const fields = input.fields.map((f) => `${f.key} (${f.label}${f.kind === "list" ? ", comma-separated" : ""}${f.options ? `, one of: ${f.options.join("/")}` : ""}${f.kind === "bool" ? ", true or false" : ""})`).join("; ");
    const out = await this.json(
      schema,
      `You help fill in an account-based marketing brain for ${input.account}. Section: ${input.section}. Find ${input.ask}. Use ONLY what the pages and files below say; never invent customers, numbers or claims. Skip anything already listed. Write plainly and briefly. Each item has these fields: ${fields}.`,
      `Already in this section:\n${input.existing.slice(0, 30).map((e) => `- ${e}`).join("\n") || "- nothing yet"}\n\n${input.context.map((c, i) => `[source ${i}] ${c.title}${c.url ? ` (${c.url})` : ""}\n${c.text.slice(0, 2500)}`).join("\n\n")}\n\nReturn {"items": [{...}]}${input.single ? " with exactly one item" : " with up to 8 items"}.`,
      1500,
    );
    return out.items;
  }
}
