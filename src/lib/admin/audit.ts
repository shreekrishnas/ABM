// Plain words for audit log actions, and the CSV export.

import type { AuditEntry } from "@prisma/client";

export const ACTION_WORD: Record<string, string> = {
  "user.add": "added a person", "user.remove": "removed a person", "user.restore": "restored a person",
  "assignment.add": "assigned", "assignment.remove": "unassigned", "client.add": "added an account", "client.logo": "changed a logo",
  "mode.super_admin": "switched to Super Admin", "mode.user": "switched to User",
  "data.clear": "cleared every account", "data.clear_account": "cleared one account", "queue.restart": "restarted the queue",
  "client.budget": "set a monthly cap", "data.email_conflicts": "closed email-only identity items", "errors.clear": "cleared the error log",
  "company.run": "ran research", "company.re_research": "re-researched", "company.re_research_all": "re-researched every company", "pipeline.run_all": "processed new companies",
  "company.update": "edited a company", "profile.refresh": "refreshed a company profile", "financials.add": "added a financial record", "financials.remove": "removed a financial record",
  "discovery.start": "started a company search", "discovery.run": "ran a company search", "influencers.find": "searched for influencers", "company.keep": "kept a company", "company.reject": "approved a rejection", "company.research_again": "asked for more research",
  "email.send_approved": "sent approved emails", "email.review": "reviewed an email", "decision.resolve": "resolved a decision", "person.identity": "decided a person's identity",
  "handoff.decide": "decided a hand-off", "handoff.manual": "handed off a company", "deal.create": "created a deal", "deal.move": "moved a deal",
  "person.erase": "erased a person (GDPR)", "person.delete": "deleted a person", "people.bulk_update": "bulk-updated people",
  "fact.flag": "marked a fact wrong", "fact.correct": "corrected a fact",
  "suggestion.approve": "approved a company", "suggestion.approve_many": "approved companies", "suggestion.dismiss": "dismissed a company",
  "lookalike.search": "searched lookalikes", "lookalike.reject": "rejected a lookalike", "lookalike.research_more": "asked for more lookalike research",
};

const cell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Quote everything; neutralise spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export function auditCsv(rows: AuditEntry[], clientName: Map<string, string>): string {
  const head = ["When (UTC)", "Who", "Action", "What", "Target", "Account", "Before", "After"];
  const body = rows.map((e) => [e.createdAt.toISOString(), e.actorEmail, e.action, ACTION_WORD[e.action] ?? e.action, e.target, e.clientId ? clientName.get(e.clientId) ?? e.clientId : "", e.before, e.after].map(cell).join(","));
  return [head.map(cell).join(","), ...body].join("\r\n");
}
