// "Waiting for you": one count and one split everywhere (Engage badge, Home, Today, Approvals, Vega).
// Deterministic fixture: two clients with a known mix of open and closed review items.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReviewType } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { withScope } from "@/lib/scope";
import { DECISION_KIND, openDecisions, summarizeWaiting, typesFor, waitingForYou, waitingNote, type Waiting } from "@/lib/decisions";
import { DECISION_FILTER_LABEL } from "@/lib/decision-labels";
import { commandCenter } from "@/lib/command-center";

const stamp = Date.now();
const A = `wait-a-${stamp}`;
const B = `wait-b-${stamp}`;
const scope = (id: string) => ({ ids: [id], active: id, choices: [], all: false });

// Client A: 16 open items of 7 kinds, plus closed ones that must not count.
const MIX_A: [ReviewType, number][] = [
  ["draft_approval", 3], ["draft_refresh", 1], ["needs_human_reply", 2],
  ["identity_conflict", 4], ["no_usable_person", 2], ["proposed_rejection", 3], ["budget_exceeded", 1],
];
const MIX_B: [ReviewType, number][] = [["draft_approval", 1], ["contradiction", 2]];

let accA = "";
let accB = "";
let base: { a: Waiting; b: Waiting };

async function seed(accountId: string, mix: [ReviewType, number][]) {
  for (const [type, n] of mix) for (let i = 0; i < n; i++) await baseDb.reviewItem.create({ data: { type, reason: "fixture", stage: 11, accountId } });
}

beforeAll(async () => {
  for (const id of [A, B]) await baseDb.client.upsert({ where: { id }, create: { id, name: id }, update: {} });
  // Counts before the fixture (shared unattached items from other tests show in every client).
  base = { a: await withScope(scope(A), waitingForYou), b: await withScope(scope(B), waitingForYou) };
  accA = (await baseDb.account.create({ data: { name: "Wait A Co", domain: `a-${stamp}.example`, sellerId: A } })).id;
  accB = (await baseDb.account.create({ data: { name: "Wait B Co", domain: `b-${stamp}.example`, sellerId: B } })).id;
  await seed(accA, MIX_A);
  await seed(accB, MIX_B);
  // Closed items never count.
  await baseDb.reviewItem.create({ data: { type: "draft_approval", reason: "fixture", stage: 11, accountId: accA, status: "resolved" } });
  await baseDb.reviewItem.create({ data: { type: "identity_conflict", reason: "fixture", stage: 4, accountId: accA, status: "dismissed" } });
});

afterAll(async () => {
  await baseDb.reviewItem.deleteMany({ where: { accountId: { in: [accA, accB] } } });
  await baseDb.account.deleteMany({ where: { id: { in: [accA, accB] } } });
  await baseDb.client.deleteMany({ where: { id: { in: [A, B] } } });
});

const minus = (x: Waiting, y: Waiting) => ({ total: x.total - y.total, checks: x.checks - y.checks, signOffs: x.signOffs - y.signOffs, emails: x.emails - y.emails });

describe("the shared split", () => {
  it("adds up: checks + sign-offs = total, emails are part of the sign-offs", () => {
    const w = summarizeWaiting(MIX_A.map(([type, _count]) => ({ type, _count })));
    expect(w).toMatchObject({ total: 16, checks: 10, signOffs: 6, emails: 3 });
    expect(w.checks + w.signOffs).toBe(w.total);
    expect(waitingNote(w)).toBe("10 checks · 6 sign-offs (3 emails)");
  });
  it("says so plainly when nothing is waiting, and uses singulars", () => {
    expect(waitingNote(summarizeWaiting([]))).toBe("Nothing waiting");
    expect(waitingNote(summarizeWaiting([{ type: "draft_approval", _count: 1 }]))).toBe("0 checks · 1 sign-off (1 email)");
  });
  it("the Today and Home filters are the same split, with the same names", () => {
    const signOffs = typesFor("approval")!;
    expect(signOffs).toContain("draft_approval");
    expect([...typesFor("exception")!, ...signOffs].sort()).toEqual(Object.keys(DECISION_KIND).sort());
    expect(DECISION_FILTER_LABEL).toEqual({ all: "All", exception: "Checks", approval: "Sign-offs" });
  });
});

describe("every screen reads the same number", () => {
  it("counts only open items, only for the client in view", async () => {
    const a = minus(await withScope(scope(A), waitingForYou), base.a);
    const b = minus(await withScope(scope(B), waitingForYou), base.b);
    expect(a).toEqual({ total: 16, checks: 10, signOffs: 6, emails: 3 });
    expect(b).toEqual({ total: 3, checks: 2, signOffs: 1, emails: 1 });
  });

  it("Home (command center), the Decision Center counts and the badge source agree", async () => {
    await withScope(scope(A), async () => {
      const w = await waitingForYou();
      const center = await openDecisions("all", 3);
      const cc = await commandCenter();
      const home = cc.kpis.find((k) => k.key === "approve")!;
      expect(center.waiting).toEqual(w);
      expect(center.counts).toEqual({ all: w.total, exception: w.checks, approval: w.signOffs });
      expect(home.value).toBe(w.total);
      expect(home.note).toBe(waitingNote(w));
      expect(home.href).toBe("/review");
    });
  });

  it("a filtered list says how many it holds, and the totals stay global", async () => {
    await withScope(scope(A), async () => {
      const w = await waitingForYou();
      const checks = await openDecisions("exception", 100);
      expect(checks.items.every((i) => i.kind === "exception")).toBe(true);
      expect(checks.counts.all).toBe(w.total); // the "All" chip still shows the whole total
      expect(checks.items.filter((i) => i.description === "fixture").length).toBe(10);
    });
  });

  it("drops by one after an approval and after a rejection, everywhere at once", async () => {
    await withScope(scope(A), async () => {
      const before = await waitingForYou();
      const email = await baseDb.reviewItem.findFirst({ where: { accountId: accA, type: "draft_approval", status: "open" } });
      await baseDb.reviewItem.update({ where: { id: email!.id }, data: { status: "resolved", resolvedAt: new Date() } });
      const rejection = await baseDb.reviewItem.findFirst({ where: { accountId: accA, type: "proposed_rejection", status: "open" } });
      await baseDb.reviewItem.update({ where: { id: rejection!.id }, data: { status: "dismissed", resolvedAt: new Date() } });
      const after = await waitingForYou();
      expect(minus(before, after)).toEqual({ total: 2, checks: 1, signOffs: 1, emails: 1 });
      const cc = await commandCenter();
      expect(cc.kpis.find((k) => k.key === "approve")!.value).toBe(after.total);
    });
  });

  it("another client's changes never move this client's count", async () => {
    const before = await withScope(scope(B), waitingForYou);
    await baseDb.reviewItem.create({ data: { type: "draft_approval", reason: "fixture", stage: 11, accountId: accA } });
    expect(await withScope(scope(B), waitingForYou)).toEqual(before);
  });
});
