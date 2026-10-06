// Live LLM via OpenRouter (default model: openai/gpt-4o-mini).
// Every call asks for strict JSON and is validated. Source URLs and dates are
// never taken from the model — they come from the fetched pages — so the model
// cannot invent a source. Compliance lines are appended by code, not the model.

import { z } from "zod";
import type { BriefingInput, BriefingOutput, DraftInput, DraftOutput, ExtractedEvidence, Inference, LLM, ResearchPage } from "../types";
import { fetchJson } from "./http";
import { inferFunction } from "@/lib/pipeline/normalize";
import { seller } from "@/lib/seller";
import { matchPersona } from "@/lib/seller/fit";

const FUNCTIONS = ["data", "it", "procurement", "finance", "sales", "operations", "compliance", "security", "engineering", "marketing", "hr", "executive"] as const;
const NEGATIVE = ["layoffs", "hiring_freeze", "acquired", "bankrupt", "competitor_signed"] as const;

export class OpenRouterLLM implements LLM {
  constructor(private apiKey: string, private model = process.env.LLM_MODEL || "openai/gpt-4o-mini") {}

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

  async extractEvidence(pages: ResearchPage[], key: string): Promise<ExtractedEvidence[]> {
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
      items: z.array(z.object({ page: z.number().int(), claim: z.string().min(5).max(240), value: z.string().max(120).nullable().optional(), kind: z.string().nullable().optional() })).max(8),
    });
    const out = await this.json(
      schema,
      "You extract facts from web pages for B2B account research. Extract only what a page states explicitly — never infer or combine pages. Write each claim as one short sentence that starts with the company name. If nothing relevant is stated, return {\"items\": []}.",
      `Question: ${key}\nGuidance: ${guide[key] ?? key}\n\n${pages.map((p, i) => `[page ${i}] ${p.title}\nURL: ${p.url}\nDate: ${p.publishedAt.toISOString().slice(0, 10)}\n${p.text.slice(0, 1800)}`).join("\n\n")}\n\nReturn {"items":[{"page": <page index>, "claim": "...", "value": "... or null", "kind": "${key === "negative" ? "one of the allowed kinds" : "null"}"}]}`,
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
      return [{ key, claim: it.claim, value, sourceUrl: p.url, sourceType: p.sourceType, publishedAt: p.publishedAt, isNegative, negativeKind: kind }];
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
    if (!persona) return "unknown" as const;
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
        attempt > 1 ? "5. A previous attempt failed fact-checking: cite a fact id for every prospect claim." : "",
      ].join("\n"),
      `Recipient: ${input.firstName ?? "there"}${input.title ? `, ${input.title}` : ""} at ${input.company}\nStep ${input.stepOrder}: ${input.instruction}\n\nFACTS:\n${input.facts.map((f) => `${f.id} [${f.key}] ${f.claim}`).join("\n")}\n\nSELLER PITCH: ${input.seller.pitch}\nCTA: ${input.seller.cta}\n\nReturn {"subject":"...","body":"...","claims":[{"text":"<sentence from body>","factIds":["<id>"]}]}`,
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
}
