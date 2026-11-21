// Platform-wide review items (no company, no person: the bounce pause, AI learning proposals) are
// for full Super Admins only. Client users neither see them nor change them; client items stay
// with their client. Checked through real sign-ins (session cookie → scope → scoped queries).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })) }),
  headers: async () => new Headers(),
}));

import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { clearScopeCache } from "@/lib/scope";
import { waitingForYou } from "@/lib/decisions";
import { systemAlerts } from "@/lib/admin/alerts";
import { resolveReviewAction, reviewDraftAction } from "@/app/actions";
import { openReview } from "@/lib/pipeline/context";

const SECRET = "test-secret-for-global-review-scope";
const prev = { secret: process.env.AUTH_SECRET, req: process.env.AUTH_REQUIRED };
beforeAll(() => { process.env.AUTH_SECRET = SECRET; process.env.AUTH_REQUIRED = "true"; });
afterAll(() => {
  for (const [k, v] of [["AUTH_SECRET", prev.secret], ["AUTH_REQUIRED", prev.req]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

async function signIn(email: string, o: { superMode?: boolean; client?: string } = {}) {
  jar.clear();
  jar.set(SESSION_COOKIE, await sessionToken(email, SECRET, 0));
  if (o.superMode) jar.set("abm_mode", "super");
  if (o.client) jar.set("abm_client", o.client);
  clearScopeCache();
}

const ids = { global: "", a: "", b: "", contactOnlyA: "" };

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: "test", name: "Client A" }, { id: "test-b", name: "Client B" }] });
  await baseDb.user.createMany({
    data: [
      { id: "full", name: "Full Admin", email: "full@trilliantdigital.com", superAdmin: true },
      { id: "some", name: "Some Admin", email: "some@trilliantdigital.com", superAdmin: true, superAdminClients: ["test"] },
      { id: "repa", name: "Rep A", email: "repa@trilliantdigital.com" },
      { id: "viewa", name: "Viewer A", email: "viewa@trilliantdigital.com" },
      { id: "repb", name: "Rep B", email: "repb@trilliantdigital.com" },
    ],
  });
  await baseDb.userClient.createMany({ data: [{ userId: "repa", clientId: "test", role: "rep" }, { userId: "viewa", clientId: "test", role: "viewer" }, { userId: "repb", clientId: "test-b", role: "rep" }] });
  const accA = await baseDb.account.create({ data: { name: "A Co", domain: "a.example", sellerId: "test" } });
  const accB = await baseDb.account.create({ data: { name: "B Co", domain: "b.example", sellerId: "test-b" } });
  const cA = await baseDb.contact.create({ data: { fullName: "Person A", accountId: accA.id } });
  ids.global = (await baseDb.reviewItem.create({ data: { type: "bounce_breaker", reason: "Hard bounce rate 9.0% > 5%", stage: 12 } })).id;
  ids.a = (await baseDb.reviewItem.create({ data: { type: "proposed_rejection", reason: "rule", stage: 3, accountId: accA.id } })).id;
  ids.b = (await baseDb.reviewItem.create({ data: { type: "proposed_rejection", reason: "rule", stage: 3, accountId: accB.id } })).id;
  ids.contactOnlyA = (await baseDb.reviewItem.create({ data: { type: "identity_conflict", reason: "check", stage: 4, contactId: cA.id } })).id;
});

const visible = async () => (await db.reviewItem.findMany({ where: { status: "open" }, select: { id: true } })).map((r) => r.id).sort();
const statusOf = async (id: string) => (await baseDb.reviewItem.findUnique({ where: { id } }))!.status;

describe("who sees which review items", () => {
  it("a Rep and a Viewer see their client's items (company- or person-linked), never another client's or platform-wide ones", async () => {
    for (const email of ["repa@trilliantdigital.com", "viewa@trilliantdigital.com"]) {
      await signIn(email);
      expect(await visible()).toEqual([ids.a, ids.contactOnlyA].sort());
      expect((await waitingForYou()).total).toBe(2);
    }
    await signIn("repb@trilliantdigital.com");
    expect(await visible()).toEqual([ids.b]);
    expect((await waitingForYou()).total).toBe(1);
  });

  it("a Super Admin limited to some clients sees those clients only, not platform-wide items", async () => {
    await signIn("some@trilliantdigital.com", { superMode: true });
    expect(await visible()).toEqual([ids.a, ids.contactOnlyA].sort());
  });

  it("a full Super Admin sees platform-wide items, across all clients or with one client picked", async () => {
    await signIn("full@trilliantdigital.com", { superMode: true });
    expect(await visible()).toEqual([ids.global, ids.a, ids.b, ids.contactOnlyA].sort());
    await signIn("full@trilliantdigital.com", { superMode: true, client: "test" });
    expect(await visible()).toEqual([ids.global, ids.a, ids.contactOnlyA].sort());
    expect((await waitingForYou()).total).toBe(3);
  });

  it("the same full Super Admin out of Super Admin mode is an ordinary user (no assignments: nothing)", async () => {
    await signIn("full@trilliantdigital.com");
    expect(await visible()).toEqual([]);
  });
});

describe("who can change which review items", () => {
  it("a Rep cannot dismiss a platform-wide item or another client's item; both stay open", async () => {
    await signIn("repa@trilliantdigital.com");
    expect(await resolveReviewAction(ids.global, "dismissed")).toMatchObject({ ok: false });
    expect(await resolveReviewAction(ids.b, "dismissed")).toMatchObject({ ok: false });
    expect(await statusOf(ids.global)).toBe("open");
    expect(await statusOf(ids.b)).toBe("open");
    // Even a direct scoped write (bypassing the action's check) can't reach it.
    await expect(db.reviewItem.update({ where: { id: ids.global }, data: { status: "dismissed" } })).rejects.toThrow();
    expect(await db.reviewItem.updateMany({ where: { id: { in: [ids.global, ids.b] } }, data: { status: "dismissed" } })).toEqual({ count: 0 });
    expect(await statusOf(ids.global)).toBe("open");
  });

  it("a Rep can resolve their own client's item", async () => {
    await signIn("repa@trilliantdigital.com");
    expect(await resolveReviewAction(ids.a, "resolved")).toMatchObject({ ok: true });
    expect(await statusOf(ids.a)).toBe("resolved");
  });

  it("a Viewer cannot resolve even their own client's item", async () => {
    await signIn("viewa@trilliantdigital.com");
    await expect(resolveReviewAction(ids.a, "resolved")).rejects.toThrow();
    expect(await statusOf(ids.a)).toBe("open");
  });

  it("a limited Super Admin cannot change platform-wide items; a full Super Admin can", async () => {
    await signIn("some@trilliantdigital.com", { superMode: true });
    expect(await resolveReviewAction(ids.global, "resolved")).toMatchObject({ ok: false });
    expect(await statusOf(ids.global)).toBe("open");
    await signIn("full@trilliantdigital.com", { superMode: true, client: "test" });
    expect(await resolveReviewAction(ids.global, "resolved")).toMatchObject({ ok: true });
    expect(await statusOf(ids.global)).toBe("resolved");
  });
});

describe("email drafts in the Approvals workspace", () => {
  const form = (draftId: string, decision: "approve" | "reject") => {
    const fd = new FormData();
    fd.set("draftId", draftId); fd.set("decision", decision); fd.set("subject", "Hello"); fd.set("body", "Body text\n\nUnsubscribe");
    return fd;
  };
  const draftIn = async (sellerId: string) => {
    const acc = await baseDb.account.findFirst({ where: { sellerId } });
    const c = await baseDb.contact.create({ data: { fullName: `Draft person ${sellerId}`, accountId: acc!.id } });
    return (await baseDb.draft.create({ data: { contactId: c.id, subject: "Hello", body: "Body text\n\nUnsubscribe", claims: [] } })).id;
  };

  it("a Viewer cannot approve or reject an email; it stays waiting", async () => {
    const id = await draftIn("test");
    await signIn("viewa@trilliantdigital.com");
    await expect(reviewDraftAction(null as never, form(id, "approve"))).rejects.toThrow();
    await expect(reviewDraftAction(null as never, form(id, "reject"))).rejects.toThrow();
    expect((await baseDb.draft.findUnique({ where: { id } }))!.status).toBe("pending_review");
  });

  it("a Rep in Client A cannot decide Client B's email, even with its id", async () => {
    const id = await draftIn("test-b");
    await signIn("repa@trilliantdigital.com");
    await expect(reviewDraftAction(null as never, form(id, "reject"))).rejects.toThrow();
    expect((await baseDb.draft.findUnique({ where: { id } }))!.status).toBe("pending_review");
  });

  it("a Rep can reject their own client's email", async () => {
    const id = await draftIn("test");
    await signIn("repa@trilliantdigital.com");
    expect(await reviewDraftAction(null as never, form(id, "reject"))).toMatchObject({ ok: true });
    expect((await baseDb.draft.findUnique({ where: { id } }))!.status).toBe("rejected");
  });
});

describe("platform-wide items aren't duplicated by a client user's request", () => {
  it("a bounce check run from a Rep's click finds the existing pause instead of opening a second one", async () => {
    await signIn("repa@trilliantdigital.com");
    const again = await openReview({ type: "bounce_breaker", stage: 12, reason: "Hard bounce rate 9.0% > 5%" });
    expect(again.id).toBe(ids.global);
    expect(await baseDb.reviewItem.count({ where: { type: "bounce_breaker", status: "open" } })).toBe(1);
  });
});

describe("the bounce pause stays in front of the responsible admin", () => {
  it("an open bounce pause raises a System health alert; resolving it clears the alert", async () => {
    const a = (await systemAlerts()).find((x) => x.key === "sending_stopped");
    expect(a).toMatchObject({ tone: "bad", href: "/review?type=bounce_breaker" });
    expect(a!.detail).toMatch(/Hard bounce rate/);
    await baseDb.reviewItem.update({ where: { id: ids.global }, data: { status: "resolved" } });
    expect((await systemAlerts()).some((x) => x.key === "sending_stopped")).toBe(false);
  });
});
