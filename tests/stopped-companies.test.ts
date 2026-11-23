// P7: a stopped company is never a dead end. It says why and offers the one step that moves it on, on
// its page and in the Companies list (with a "Stopped" filter). Production: 4 of 11 companies stopped,
// two with no reason or step shown anywhere.
import { beforeEach, describe, expect, it } from "vitest";
import { baseDb } from "@/lib/db-base";
import { nextStep, stopReasons } from "@/lib/accounts/stop";
import { accountWhere } from "@/lib/accounts/filters";

describe("the next step for each kind of stop", () => {
  it("an open decision comes first and opens that exact item in Approvals", () => {
    expect(nextStep("a1", "Rejection proposed: Too small", { id: "r9", type: "proposed_rejection" })).toEqual({ kind: "decide", label: "Decide in Approvals", href: "/review?type=proposed_rejection&pick=r9" });
  });
  it("no usable person → see who was found; research incomplete → research again; anything else → run again", () => {
    expect(nextStep("a1", "No ready contacts")).toEqual({ kind: "people", label: "See who was found", href: "/accounts/a1?tab=people" });
    expect(nextStep("a1", "Research incomplete — Round limit reached (2 for T3)")).toMatchObject({ kind: "research", label: "Research again" });
    expect(nextStep("a1", "Website could not be read")).toMatchObject({ kind: "run", label: "Run again" });
  });
});

describe("why each company stopped", () => {
  beforeEach(async () => {
    const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
    await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
    await baseDb.client.create({ data: { id: "manch", name: "Manch" } });
  });
  it("the latest blocked or failed step, else the last error, else said plainly; and the list filter finds them", async () => {
    const a = await baseDb.account.create({ data: { name: "A", sellerId: "manch", pipelineStatus: "blocked" } });
    const b = await baseDb.account.create({ data: { name: "B", sellerId: "manch", pipelineStatus: "error", lastError: "Website timed out" } });
    const c = await baseDb.account.create({ data: { name: "C", sellerId: "manch", pipelineStatus: "blocked" } });
    await baseDb.account.create({ data: { name: "D", sellerId: "manch", pipelineStatus: "done" } });
    const ev = (accountId: string, reason: string, at: number) => ({ accountId, runId: "r", stage: 9, step: "orchestrator.stop", outcome: "block" as const, reason, createdAt: new Date(Date.now() - at) });
    await baseDb.pipelineEvent.createMany({ data: [ev(a.id, "Older reason", 60_000), ev(a.id, "No ready contacts", 1_000)] });
    const r = await stopReasons([{ id: a.id }, { id: b.id, lastError: "Website timed out" }, { id: c.id }]);
    expect(r.get(a.id)).toBe("No ready contacts");
    expect(r.get(b.id)).toBe("Website timed out");
    expect(r.get(c.id)).toBe("Stopped without a recorded reason");
    expect((await baseDb.account.findMany({ where: accountWhere({ progress: "stopped" }), orderBy: { name: "asc" } })).map((x) => x.name)).toEqual(["A", "B", "C"]);
  });
});
