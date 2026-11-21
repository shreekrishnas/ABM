// Level 3 tools: consequential work that only ever runs after a person confirms it in Vega.
import { z } from "zod";
import type { AgentTool } from "./types";

const define = <S extends z.ZodTypeAny>(t: AgentTool<S>): AgentTool => t as unknown as AgentTool;

/**
 * Approve chosen emails. Each one goes through the normal approval path on its own (still
 * waiting, evidence current, unsubscribe line), so a failing one never stops the others.
 * Approved emails go out with the next send; they can't be recalled.
 */
export const approveDraftsTool = define({
  name: "approve_drafts",
  description: "Approve specific emails waiting for approval (draft ids from recommended_approvals; at most 25). Each is checked again and then goes out with the next send. Cannot be undone.",
  input: z.object({ draftIds: z.array(z.string().min(5).max(40)).min(1).max(25) }),
  level: 3,
  minRole: "manager",
  reversible: false,
  run: async ({ draftIds }) => {
    const { db } = await import("@/lib/db");
    const { reviewDraftAction } = await import("@/app/actions");
    const results: { draftId: string; who: string; ok: boolean; message: string }[] = [];
    for (const id of [...new Set(draftIds)]) {
      const d = await db.draft.findUnique({ where: { id }, select: { id: true, subject: true, body: true, contact: { select: { fullName: true, account: { select: { name: true } } } } } });
      if (!d) { results.push({ draftId: id, who: "?", ok: false, message: "Not found in this client" }); continue; }
      const fd = new FormData();
      fd.set("draftId", d.id); fd.set("decision", "approve"); fd.set("subject", d.subject); fd.set("body", d.body); fd.set("note", "Approved through Vega");
      const r = await reviewDraftAction({ ok: true, message: "" }, fd).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : "Failed" }));
      results.push({ draftId: id, who: `${d.contact.fullName} (${d.contact.account.name})`, ok: Boolean(r?.ok), message: r?.message ?? "" });
    }
    return { approved: results.filter((r) => r.ok).length, of: results.length, results };
  },
});

export const LEVEL3 = [approveDraftsTool];
