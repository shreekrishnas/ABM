// The built-in part of the knowledge base, generated from what the app already knows:
// the researched sources (./sources.ts), the writing playbook (./playbook.ts) and the
// seller pack (personas, market norms, objections, examples, market facts, use cases,
// proof points, customers, competitors, products). Each item becomes one document with
// a stable key and filter tags, so re-indexing only re-embeds what changed.

import type { SellerProfile } from "@/lib/seller/types";
import { PLAYS, playBrief } from "../playbook";
import { SOURCES } from "../sources";

export interface DocTags {
  channel?: "email" | "linkedin";
  plays?: string[];
  personas?: string[];
  useCases?: string[];
  triggers?: string[];
}

export interface CorpusDoc {
  key: string;
  kind: string;
  title: string;
  text: string;
  url?: string;
  tags?: DocTags;
  /** True when the doc's statements about the seller may be used in messages. */
  approved: boolean;
}

const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");

export function builtInCorpus(sp: SellerProfile): CorpusDoc[] {
  const docs: CorpusDoc[] = [];

  for (const s of Object.values(SOURCES)) {
    docs.push({
      key: `builtin:research:${s.id}`,
      kind: "research",
      title: `${s.title} (${s.publisher}, ${s.date})`,
      text: `Based on: ${s.basis}\n\nFindings:\n${bullets(s.findings)}`,
      url: s.url,
      approved: false,
    });
  }

  for (const p of Object.values(PLAYS)) {
    docs.push({ key: `builtin:playbook:${p.key}`, kind: "playbook", title: `Playbook: ${p.label}`, text: playBrief(p), tags: { channel: p.channel, plays: [p.key] }, approved: false });
  }

  const w = sp.writing;
  if (w) {
    docs.push({ key: "builtin:norm:market", kind: "norm", title: `Market norms: ${w.market.label}`, text: bullets(w.market.norms.map((n) => n.text)), approved: false });
    for (const p of w.personas) {
      docs.push({
        key: `builtin:persona:${p.key}`,
        kind: "persona",
        title: `Persona: ${p.name}`,
        text: [`Role in the buying group: ${p.role.replace(/_/g, " ")}. Functions: ${p.functions.join(", ")}. Titles: ${p.titleHints.join(", ")}.`, `What they care about:\n${bullets(p.cares)}`, `Words they use: ${p.language.join(", ")}`, `Avoid:\n${bullets(p.avoid)}`, `Opening that lands: ${p.opener}`].join("\n\n"),
        tags: { personas: [p.key] },
        approved: false,
      });
    }
    for (const f of w.marketFacts) docs.push({ key: `builtin:market_fact:${f.id}`, kind: "market_fact", title: `Market fact (${f.attribution})`, text: f.text, url: f.source && SOURCES[f.source]?.url, approved: true });
    for (const o of w.objections) docs.push({ key: `builtin:objection:${o.key}`, kind: "objection", title: `Objection: ${o.objection}`, text: `They say: ${o.objection}\n\nHow to answer: ${o.answer}`, approved: true });
    for (const e of w.examples) {
      const play = PLAYS[e.play];
      docs.push({
        key: `builtin:example:${e.id}`,
        kind: "example",
        title: `${e.quality === "good" ? "Good" : "Bad"} example: ${play?.label ?? e.play} to ${w.personas.find((p) => p.key === e.persona)?.name ?? e.persona}`,
        text: `${e.subject ? `Subject: ${e.subject}\n\n` : ""}${e.body}\n\n${e.quality === "good" ? "Why it works" : "Why it fails"}: ${e.why}`,
        tags: { channel: play?.channel, plays: [e.play], personas: [e.persona], useCases: e.useCase ? [e.useCase] : undefined, triggers: e.trigger ? [e.trigger] : undefined },
        approved: false,
      });
    }
  }

  for (const u of sp.useCases) {
    const pitch = sp.messaging.byUseCase[u.key];
    docs.push({ key: `builtin:use_case:${u.key}`, kind: "product", title: `Use case: ${u.name}`, text: `Pains: ${u.pains}\n\nOutcome: ${u.outcome}${pitch ? `\n\nApproved pitch: ${pitch}` : ""}`, tags: { useCases: [u.key] }, approved: true });
  }
  for (const p of sp.products) docs.push({ key: `builtin:product:${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, kind: "product", title: `Product: ${p.name}`, text: p.what, approved: true });
  sp.proofPoints.forEach((p, i) => docs.push({ key: `builtin:proof:${i}`, kind: "case_study", title: `Proof point (${p.source})`, text: p.text, approved: true }));
  for (const c of sp.customers) {
    docs.push({
      key: `builtin:customer:${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      kind: "case_study",
      title: `Customer story: ${c.publicReference ? c.name : "unnamed customer"}`,
      text: `${c.story}${c.publicReference ? "" : "\n\nNot a public reference: never name this customer in a message."}`,
      approved: c.publicReference,
    });
  }
  for (const c of sp.competitors) docs.push({ key: `builtin:competitor:${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, kind: "competitor", title: `Competitor: ${c.name} (${c.category})`, text: `How to position against it: ${c.angle}\n\nPosition against it; never attack it by name in a cold message.`, approved: false });

  return docs;
}
