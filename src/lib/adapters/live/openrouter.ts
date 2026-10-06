// Live LLM via OpenRouter (default model: openai/gpt-4o-mini).
// Every call asks for strict JSON and is validated. Source URLs and dates are
// never taken from the model — they come from the fetched pages — so the model
// cannot invent a source. Compliance lines are appended by code, not the model.

import { z } from "zod";
import type { BriefingInput, BriefingOutput, DraftInput, DraftOutput, ExtractedEvidence, Inference, LLM, ResearchPage } from "../types";
import { briefSchema, claimCheckSchema, insightSchema, planResearchSchema, type BrainStats, type BriefInput, type ClaimToCheck, type PlanResearchInput } from "@/lib/brain/types";
import { fetchJson } from "./http";
import { inferFunction } from "@/lib/pipeline/normalize";
import { seller } from "@/lib/seller";
import { matchPersona } from "@/lib/seller/fit";

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

  private async json<T>(schema: z.ZodType<T>, system: string, user: string, maxTokens = 900): Promise<T> {
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
        messages: [
          { role: "system", content: `${system}\nRespond with a single JSON object only.` },
          { role: "user", content: user },
        ],
      }),
      timeoutMs: 45_000,
    });
    const text = res.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      throw new Error(`OpenRouter returned non-JSON output`);
    }
    return schema.parse(parsed);
  }

  async extractEvidence(pages: ResearchPage[], key: string, known: { id: string; claim: string }[] = []): Promise<ExtractedEvidence[]> {
    if (!pages.length) return [];
    const sp = seller();
    const guide: Record<string, string> = {
      trigger: `Recent events that create a need for ${sp.name} (${sp.triggers.map((t) => t.label).join("; ")}). One item per distinct event.`,
      negative: `Only explicit negative events. kind must be one of: ${NEGATIVE.join(", ")}.`,
      owner_function: `Which function owns partner/vendor onboarding or master data. value must be one of: ${FUNCTIONS.join(", ")}.`,
      tooling: "ERP, MDM, workflow, KYC or eSign tools the company uses. value = comma-separated tool names.",
      partner_network: "Size of the external network (distributors, dealers, retailers, vendors, delivery partners). value = the number only, digits.",
    };
    const schema = z.object({
      items: z.array(z.object({ page: z.number().int(), claim: z.string().min(5).max(240), value: z.string().max(120).nullable().optional(), kind: z.string().nullable().optional(), sameAs: z.string().nullable().optional() })).max(8),
    });
    const out = await this.json(
      schema,
      "You extract facts from web pages for B2B account research. Extract only what a page states explicitly — never infer or combine pages. Write each claim as one short sentence that starts with the company name. If nothing relevant is stated, return {\"items\": []}.",
      `Question: ${key}\nGuidance: ${guide[key] ?? key}\n${known.length ? `\nFacts we already hold (if a page reports the SAME event or value, set "sameAs" to that fact id):\n${known.map((k) => `${k.id}: ${k.claim}`).join("\n")}\n` : ""}\n${pages.map((p, i) => `[page ${i}] ${p.title}\nURL: ${p.url}\nDate: ${p.publishedAt.toISOString().slice(0, 10)}\n${p.text.slice(0, 1800)}`).join("\n\n")}\n\nReturn {"items":[{"page": <page index>, "claim": "...", "value": "... or null", "kind": "${key === "negative" ? "one of the allowed kinds" : "null"}", "sameAs": "<known fact id or null>"}]}`,
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
      return [{ key, claim: it.claim, value, sourceUrl: p.url, sourceType: p.sourceType, publishedAt: p.publishedAt, isNegative, negativeKind: kind, sameAsFactId }];
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
        `You write first-touch B2B emails for ${input.seller.name}. Plain, specific, under 120 words, no hype, no fake familiarity.`,
        "Rules:",
        "1. Every sentence about the prospect must come from the FACTS list and be listed in claims with that fact's id.",
        "2. Do not mention anything about the prospect that is not in FACTS. Do not guess numbers.",
        "3. Use the SELLER PITCH for what the seller does; you may shorten it but must not add new claims.",
        "4. End with the CTA. Do not add a signature, address or unsubscribe line — the system appends them.",
        "5. If an ANGLE is given, build the email around that pain and capability for this person's role; the pain is a hypothesis, so phrase it as a question or 'teams like yours often…', never as a fact about them.",
        attempt > 1 ? "6. A previous attempt failed fact-checking: cite a fact id for every prospect claim and keep each claim's wording close to the fact." : "",
      ].join("\n"),
      `Recipient: ${input.firstName ?? "there"}${input.title ? `, ${input.title}` : ""} at ${input.company}\nStep ${input.stepOrder}: ${input.instruction}\n\nFACTS:\n${input.facts.map((f) => `${f.id} [${f.key}] ${f.claim}`).join("\n")}${input.angle ? `\n\nANGLE for a ${input.angle.persona}: pain (hypothesis) = ${input.angle.pain}; ${input.seller.name} capability = ${input.angle.capability}${input.angle.proofPoint ? `; proof point = ${input.angle.proofPoint}` : ""}` : ""}${input.learnings?.length ? `\n\nWHAT HAS WORKED BEFORE (style advice only):\n- ${input.learnings.join("\n- ")}` : ""}\n\nSELLER PITCH: ${input.seller.pitch}\nCTA: ${input.seller.cta}\n\nReturn {"subject":"...","body":"...","claims":[{"text":"<sentence from body>","factIds":["<id>"]}]}`,
      700,
    );
    const footer = `\n\n${input.sender.name}\n${input.sender.company} · ${input.sender.address}\n\nReply "unsubscribe" and I won't email again.`;
    return { subject: out.subject, body: out.body.trim() + footer, angle: input.facts[0]?.key ?? null, claims: out.claims };
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
}
