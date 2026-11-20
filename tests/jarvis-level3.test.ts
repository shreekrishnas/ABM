import { afterAll, describe, expect, it } from "vitest";
import { agreement, scoreDraft } from "@/lib/agent/approvals";
import { REGISTRY } from "@/lib/agent/registry";
import { baseDb } from "@/lib/db-base";

const passAll = [{ critic: "facts", pass: true }, { critic: "compliance", pass: true }, { critic: "style (model)", pass: true }];
const base = { critique: passAll, rewrites: 0, claimsCount: 2, leadEvidence: true, fresh: { ok: true }, tier: "T1", readiness: "ready" };

describe("JARVIS Level 3: how strong each email is", () => {
  it("calls a clean, sourced, current draft strong and recommends approving it", () => {
    const s = scoreDraft(base);
    expect(s.strength).toBe("strong");
    expect(s.recommendation).toBe("approve");
    expect(s.reasons.join(" ")).toMatch(/quality checks/);
  });
  it("never calls a draft strong if a check failed or its evidence went stale", () => {
    expect(scoreDraft({ ...base, critique: [...passAll.slice(0, 2), { critic: "style (model)", pass: false, issues: ["vague"] }] }).strength).toBe("weak");
    const stale = scoreDraft({ ...base, fresh: { ok: false, reason: "trigger is 120 days old" } });
    expect(stale).toMatchObject({ strength: "weak", recommendation: "reject" });
    expect(stale.reasons.join(" ")).toMatch(/120 days/);
  });
  it("asks for an edit when the draft is only fair", () => {
    expect(scoreDraft({ ...base, leadEvidence: false, rewrites: 2, tier: "T3" })).toMatchObject({ strength: "fair", recommendation: "edit" });
  });
});

describe("JARVIS Level 3: it never approves by itself", () => {
  it("has no tool that approves or sends; the approvals list is read-only", () => {
    const names = Object.keys(REGISTRY);
    expect(names.some((n) => /approve_|send_|reject_/.test(n))).toBe(false);
    expect(REGISTRY.recommended_approvals.level).toBe(0);
    expect(Object.values(REGISTRY).every((t) => !t.contactsPeople)).toBe(true);
  });
});

describe("JARVIS Level 3: learning how often people agree", () => {
  const sellerId = `l3-test-${Date.now()}`;
  afterAll(async () => { await baseDb.agentAction.deleteMany({ where: { sellerId } }); });
  it("counts an unedited approval of a strong draft as agreement, and an edit of a strong one as not", async () => {
    const mk = (i: number, result: object) => baseDb.agentAction.create({ data: { sellerId, tool: "decide_draft", level: 3, actor: "sa@example.com", origin: "chat", reason: "x", evidenceIds: [], input: {}, result, status: "done", idempotencyKey: `${sellerId}-${i}` } });
    await mk(1, { recommendation: "approve", decision: "approve", edited: false });
    await mk(2, { recommendation: "approve", decision: "approve", edited: true });
    await mk(3, { recommendation: "reject", decision: "reject", edited: false });
    await mk(4, { recommendation: "edit", decision: "approve", edited: true });
    const a = await agreement(sellerId);
    expect(a.decisions).toBe(4);
    expect(a.agreedShare).toBe(0.75);
    expect(a.strongApprovedUnedited).toBe(0.5);
  });
});
