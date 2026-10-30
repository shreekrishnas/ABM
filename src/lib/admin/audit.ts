// Plain words for audit log actions, and the CSV export.

import type { AuditEntry } from "@prisma/client";

export const ACTION_WORD: Record<string, string> = {
  "user.add": "added a person", "user.remove": "removed a person", "user.restore": "restored a person",
  "assignment.add": "assigned", "assignment.remove": "unassigned", "client.add": "added an account", "client.logo": "changed a logo",
  "mode.super_admin": "switched to Super Admin", "mode.user": "switched to User",
  "data.clear": "cleared every account", "data.clear_account": "cleared one account", "queue.restart": "restarted the queue",
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
