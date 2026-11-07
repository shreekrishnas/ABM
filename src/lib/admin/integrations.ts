// Every connection the platform uses, with its real state and last activity (no secrets).

import { db } from "@/lib/db";
import { serviceStatus, type ServiceMode } from "@/lib/adapters";
import { aiPause } from "@/lib/admin/ai-pause";

export type IntegrationState = "connected" | "paused" | "setup" | "off" | "planned" | "sample";

export interface Integration {
  key: string;
  name: string;
  what: string;
  state: IntegrationState;
  detail: string;
  last: Date | null;
  lastLabel: string;
  href: string | null;
  action: string;
}

const fromMode = (m: ServiceMode): IntegrationState => (m === "live" ? "connected" : m === "sample" ? "sample" : m === "planned" ? "planned" : "off");

export async function integrations(): Promise<Integration[]> {
  const s = Object.fromEntries(serviceStatus().map((x) => [x.key, x]));
  const [paused, lastLlm, lastSearch, lastApollo, lastVisitorSync, lastTracked, lastSent, lastReply] = await Promise.all([
    aiPause(),
    db.ledgerEntry.findFirst({ where: { kind: "llm" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.ledgerEntry.findFirst({ where: { kind: "search" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.pipelineEvent.findFirst({ where: { OR: [{ step: { startsWith: "apollo." } }, { step: { startsWith: "visitors.enrich" } }, { step: "enrichment.paid_lookup" }] }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.pipelineEvent.findFirst({ where: { step: "apollo.visitors" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, reason: true } }),
    db.webVisit.findFirst({ where: { source: { in: ["tracking_script", "reverse_ip"] } }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    db.message.findFirst({ where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
    db.reply.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
  ]);
  const ai = fromMode(s.llm.mode);
  return [
    { key: "apollo", name: "Apollo", what: "Contacts, company data and website visitors", state: fromMode(s.provider.mode), detail: s.provider.mode === "live" ? `${s.provider.via}. ${s.intent.via}.` : s.provider.via, last: lastApollo?.createdAt ?? null, lastLabel: "Last used", href: "/import/apollo", action: s.provider.mode === "live" ? "Website visitors" : "How to connect" },
    { key: "openrouter", name: "OpenRouter (AI)", what: "Research, scoring, drafts and the assistant", state: paused && ai === "connected" ? "paused" : ai, detail: paused ? `Paused by ${paused.by}. ${s.llm.via}.` : s.llm.via, last: lastLlm?.createdAt ?? null, lastLabel: "Last AI call", href: "/team?tab=system", action: paused ? "Resume AI" : "Spending" },
    { key: "search", name: "Web search", what: "Finds news, filings and company pages", state: fromMode(s.research.mode), detail: s.research.via, last: lastSearch?.createdAt ?? null, lastLabel: "Last search", href: null, action: "" },
    { key: "tracking", name: "Website tracking", what: "Identifies companies visiting your site (your own script or a reverse-IP tool)", state: lastTracked ? "connected" : "setup", detail: lastTracked ? "Receiving visits from your site" : "Add the tracking script to your website, or point a reverse-IP tool at the visitors webhook", last: lastTracked?.occurredAt ?? null, lastLabel: "Last visit", href: "/settings", action: lastTracked ? "Settings" : "Set up" },
    { key: "email", name: "Email sending", what: "Sends approved emails; replies and bounces come back here", state: fromMode(s.email.mode) === "off" ? "setup" : fromMode(s.email.mode), detail: s.email.via, last: lastSent?.sentAt ?? lastReply?.receivedAt ?? null, lastLabel: "Last email sent", href: "/settings", action: s.email.mode === "live" ? "Senders" : "Set up" },
    { key: "visitors-sync", name: "Apollo visitor sync", what: "Daily pull of the Apollo website-visitor list", state: fromMode(s.intent.mode), detail: lastVisitorSync?.reason ?? s.intent.via, last: lastVisitorSync?.createdAt ?? null, lastLabel: "Last sync", href: "/import/apollo", action: "Open" },
    { key: "hubspot", name: "HubSpot", what: "Two-way sync of companies, contacts and deals", state: "planned", detail: "Planned: keeps your CRM and this workspace in step", last: null, lastLabel: "", href: null, action: "" },
    { key: "slack", name: "Slack alerts", what: "Queue stopped, AI failed, spending spikes", state: "planned", detail: s.notifier.via, last: null, lastLabel: "", href: null, action: "" },
  ];
}
