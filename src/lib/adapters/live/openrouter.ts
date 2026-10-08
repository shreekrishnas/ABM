// Live LLM via OpenRouter (default model: openai/gpt-4o-mini).
// Every call asks for strict JSON and is validated. Source URLs and dates are
// never taken from the model — they come from the fetched pages — so the model
// cannot invent a source. Compliance lines are appended by code, not the model.

import { z } from "zod";
import type { BriefingInput, BriefingOutput, CritiqueInput, CritiqueOutput, DraftInput, DraftOutput, ExtractedEvidence, Inference, LLM, ResearchPage } from "../types";
import { briefSchema, claimCheckSchema, insightSchema, planResearchSchema, type BrainStats, type BriefInput, type ClaimToCheck, type PlanResearchInput } from "@/lib/brain/types";
import { fetchJson } from "./http";
import { inferFunction } from "@/lib/pipeline/normalize";
import { seller } from "@/lib/seller";
import { matchPersona } from "@/lib/seller/fit";
import { JOURNEY_STAGES, STAGE_INFO } from "@/lib/journey/stages";

const FUNCTIONS = ["data", "it", "procurement", "finance", "sales", "operations", "compliance", "security", "engineering", "marketing", "hr", "executive"] as const;
const NEGATIVE = ["layoffs", "hiring_freeze", "acquired", "bankrupt", "competitor_signed"] as const;

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

  async extractEvidence(pages: ResearchPage[], key: string, known: { id: string; claim: string }[] = []): Promise<ExtractedEvidence[]> {
    if (!pages.length) return [];
    const sp = seller();
    const fixed: Record<string, string> = {
      trigger: `Recent events that create a need for ${sp.name} (${sp.triggers.map((t) => t.label).join("; ")}). One item per distinct event.`,
      negative: `Only explicit negative events. kind must be one of: ${NEGATIVE.join(", ")}.`,
    };
    const q = sp.researchQuestions.find((x) => x.key === key);
    const guide: Record<string, string> = { [key]: fixed[key] ?? q?.extract ?? q?.question ?? key };
    if (key === "owner_function") guide[key] += ` value must be one of: ${FUNCTIONS.join(", ")}.`;
    const schema = z.object({
      items: z.array(z.object({ page: z.number().int(), claim: z.string().min(5).max(240), quote: z.string().max(400).nullable().optional(), value: z.string().max(120).nullable().optional(), kind: z.string().nullable().optional(), sameAs: z.string().nullable().optional() })).max(8),
    });
    const out = await this.json(
      schema,
      "You extract facts from web pages for B2B account research. Extract only what a page states explicitly — never infer or combine pages. For every item, copy into \"quote\" the exact sentence from the page that supports it, character for character. Write each claim as one short sentence that starts with the company name. If nothing relevant is stated, return {\"items\": []}.",
      `Question: ${key}\nGuidance: ${guide[key] ?? key}\n${known.length ? `\nFacts we already hold (if a page reports the SAME event or value, set "sameAs" to that fact id):\n${known.map((k) => `${k.id}: ${k.claim}`).join("\n")}\n` : ""}\n${pages.map((p, i) => `[page ${i}] ${p.title}\nURL: ${p.url}\nDate: ${p.publishedAt.toISOString().slice(0, 10)}\n${p.text.slice(0, 1800)}`).join("\n\n")}\n\nReturn {"items":[{"page": <page index>, "claim": "...", "quote": "<exact sentence copied from that page>", "value": "... or null", "kind": "${key === "negative" ? "one of the allowed kinds" : "null"}", "sameAs": "<known fact id or null>"}]}`,
    );
    return out.items.flatMap((it) => {
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
    const schema = z.object({
      subject: z.string().min(3).max(90),
      body: z.string().min(40).max(1400),
      claims: z.array(z.object({ text: z.string(), factIds: z.array(z.string()) })).max(4),
    });
    const out = await this.json(
      schema,
      [
        `You write first-touch B2B emails for ${input.seller.name}. ${(input.tone?.length ? input.tone : ["Plain, specific, under 120 words, no hype, no fake familiarity"]).join(". ")}.`,
        input.bannedClaims?.length ? `Never claim: ${input.bannedClaims.join("; ")}.` : "",
        "Rules:",
        "1. Every sentence about the prospect must come from the FACTS list and be listed in claims with that fact's id.",
        "2. Do not mention anything about the prospect that is not in FACTS. Do not guess numbers.",
        "3. Use the SELLER PITCH for what the seller does; you may shorten it but must not add new claims.",
        "4. End with the CTA. Do not add a signature, address or unsubscribe line — the system appends them.",
        "5. If an ANGLE is given, build the email around that pain and capability for this person's role; the pain is a hypothesis, so phrase it as a question or 'teams like yours often…', never as a fact about them.",
        attempt > 1 && !input.revise ? "6. A previous attempt failed fact-checking: cite a fact id for every prospect claim and keep each claim's wording close to the fact." : "",
        "7. Open with the most specific converging signal from SIGNALS (a running LinkedIn conversation beats everything). Anything you say about the prospect must still cite a FACT id; a LinkedIn conversation may be referred to as 'our conversation on LinkedIn'. Never use stock phrases (hope this finds you well, touch base, I came across, streamline your operations, unlock potential).",
        input.revise ? "6. You are REWRITING the previous version below. Fix every listed issue, keep what works, and keep every remaining claim tied to a fact id." : "",
      ].join("\n"),
      `Recipient: ${input.firstName ?? "there"}${input.title ? `, ${input.title}` : ""} at ${input.company}\nStep ${input.stepOrder}: ${input.instruction}\n\nFACTS:\n${input.facts.map((f) => `${f.id} [${f.key}] ${f.claim}`).join("\n")}${input.angle ? `\n\nANGLE for a ${input.angle.persona}: pain (hypothesis) = ${input.angle.pain}; ${input.seller.name} capability = ${input.angle.capability}${input.angle.proofPoint ? `; proof point = ${input.angle.proofPoint}` : ""}` : ""}${input.learnings?.length ? `\n\nWHAT HAS WORKED BEFORE (style advice only):\n- ${input.learnings.join("\n- ")}` : ""}${input.signals?.length ? `\n\nSIGNALS (converging, strongest first):\n- ${input.signals.join("\n- ")}` : ""}\n\nSELLER PITCH: ${input.seller.pitch}\nCTA: ${input.seller.cta}${input.revise ? `\n\nPREVIOUS VERSION\nSubject: ${input.revise.subject}\n${input.revise.body.split("\n\n" + input.sender.name)[0]}\n\nISSUES TO FIX:\n- ${input.revise.issues.join("\n- ")}` : ""}\n\nReturn {"subject":"...","body":"...","claims":[{"text":"<sentence from body>","factIds":["<id>"]}]}`,
      700,
    );
    const footer = `\n\n${input.sender.name}\n${input.sender.company} · ${input.sender.address}\n\nReply "unsubscribe" and I won't email again.`;
    return { subject: out.subject, body: out.body.trim() + footer, angle: input.facts[0]?.key ?? null, claims: out.claims };
  }

  async critiqueDraft(input: CritiqueInput): Promise<CritiqueOutput> {
    const schema = z.object({ pass: z.boolean(), issues: z.array(z.string().min(3).max(240)).max(6), strengths: z.array(z.string().max(200)).max(4) });
    return this.json(
      schema,
      "You are a strict reviewer of B2B cold emails. Judge only the email given. Fail it for: tone rules broken, any banned claim, a statement about the prospect presented as fact when it is a guess, not relevant to the recipient's role or the stated angle, or longer than 150 words before the signature. Each issue must say exactly what to change.",
      `Recipient: ${input.recipientTitle ?? "unknown role"} at ${input.company}\nAngle: ${input.angle ?? "none"}\nTone rules: ${input.tone.join("; ")}\nBanned claims: ${input.bannedClaims.join("; ") || "none"}\n\nSubject: ${input.subject}\n${input.body}\n\nReturn {"pass": true|false, "issues": ["..."], "strengths": ["..."]}`,
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
        `NEGATIVE NEWS: ${input.negatives.join(" | ") || "none found"}`,
        `UNKNOWN: ${input.unknowns.join(", ") || "nothing"}`,
        `RESEARCH HYPOTHESES: ${input.hypotheses.join(" | ") || "none"}`,
        input.intent ? `INTENT SIGNALS (score ${input.intent.score}, ${input.intent.level}; independent families converging is what matters): ${input.intent.signals.map((s) => `[${s.family}] ${s.label}`).join(" | ") || "none"}. Build "why now" from the strongest CONVERGING signals and name them specifically; if only one weak family exists, say the timing is unproven.` : "",
        input.imported ? `FROM THE CLIENT'S IMPORT: systems ${input.imported.technologies.join(", ") || "—"}; keywords ${input.imported.keywords.join(", ") || "—"}; team notes: ${input.imported.notes ?? "—"}; LinkedIn conversations already running: ${input.imported.conversations.map((c) => `${c.name} (${c.title ?? "?"}) — ${c.stage}${c.lastReply ? `: "${c.lastReply.slice(0, 120)}"` : ""}`).join(" | ") || "none"}. If a conversation is running, the next best action must build on it.` : "",
        `${input.seller.name.toUpperCase()} PRODUCTS: ${input.seller.products.map((p) => `${p.name}: ${p.what}`).join(" | ")}`,
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
}
