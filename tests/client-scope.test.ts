import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { scopeFor, withScope, type Scope } from "@/lib/scope";
import { ingestRows } from "@/lib/pipeline/ingest";
import { commandCenter, companyFlow } from "@/lib/command-center";

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "acme", name: "Acme" }] });
  await baseDb.user.create({ data: { id: "u1", name: "Asha Rao", email: "asha@trilliantdigital.com", status: "active", clients: { create: [{ clientId: "acme" }] } } });
  await baseDb.user.create({ data: { id: "u2", name: "Super", email: "super@trilliantdigital.com", status: "active", superAdmin: true, clients: { create: [{ clientId: "manch" }] } } });
  const m = await baseDb.account.create({ data: { name: "Manch Co", domain: "manchco.in", sellerId: "manch" } });
  const a = await baseDb.account.create({ data: { name: "Acme Target", domain: "acmetarget.com", sellerId: "acme" } });
  await baseDb.contact.create({ data: { accountId: m.id, fullName: "Ravi M", email: "ravi@manchco.in" } });
  await baseDb.contact.create({ data: { accountId: a.id, fullName: "Ana A", email: "ana@acmetarget.com" } });
  await baseDb.task.create({ data: { title: "Call Ravi", accountId: m.id } });
});

const only = (id: string): Scope => ({ ids: [id], active: id, choices: [{ id, name: id }], all: false });

describe("client separation", () => {
  it("a person sees only their clients' companies, people and tasks, on every query", async () => {
    await withScope(only("acme"), async () => {
      expect((await db.account.findMany()).map((x) => x.name)).toEqual(["Acme Target"]);
      expect(await db.contact.count()).toBe(1);
      expect(await db.task.count()).toBe(0);
      const other = await baseDb.account.findUnique({ where: { domain: "manchco.in" } });
      expect(await db.account.findUnique({ where: { id: other!.id } })).toBeNull();
      // Writes can't reach another client's company either.
      expect((await db.account.updateMany({ where: { id: other!.id }, data: { name: "x" } })).count).toBe(0);
      const flow = await companyFlow();
      expect(flow.accounts.map((x) => x.name)).toEqual(["Acme Target"]);
      expect((await commandCenter()).funnel[0].value).toBe(1);
    });
    // Outside a request (cron, queue): everything.
    expect(await db.account.count()).toBe(2);
  });

  it("works out the scope from the person's assignments and Super Admin mode", async () => {
    expect((await scopeFor("asha@trilliantdigital.com", false, null)).ids).toEqual(["acme"]);
    expect((await scopeFor("asha@trilliantdigital.com", false, "manch")).ids).toEqual(["acme"]); // can't pick a client they aren't on
    expect((await scopeFor("super@trilliantdigital.com", false, null)).ids).toEqual(["manch"]);
    // A Super Admin can open any account, even one they're not assigned to.
    expect((await scopeFor("super@trilliantdigital.com", false, null)).choices.map((c) => c.id)).toEqual(["acme", "manch"]);
    expect((await scopeFor("super@trilliantdigital.com", false, "acme")).ids).toEqual(["acme"]);
    const sup = await scopeFor("super@trilliantdigital.com", true, null);
    expect(sup.ids).toBeNull();
    expect(sup.active).toBeNull();
    expect((await scopeFor("super@trilliantdigital.com", true, "acme")).ids).toEqual(["acme"]);
    expect((await scopeFor("nobody@trilliantdigital.com", false, null)).ids).toEqual([]);
  });

  it("imports go to the picked client; a company another client has is skipped, not shared", async () => {
    await withScope(only("acme"), async () => {
      const r = await ingestRows([{ company: "New Acme Prospect", domain: "newprospect.com" }, { company: "Manch Co", domain: "manchco.in" }], { source: "manual" });
      expect(r.accepted).toBe(1);
      expect(r.errors[0].error).toMatch(/already belongs to another client/);
    });
    expect((await baseDb.account.findUnique({ where: { domain: "newprospect.com" } }))!.sellerId).toBe("acme");
    expect((await baseDb.importBatch.findFirst())!.sellerId).toBe("acme");
  });

  it("with several clients in view, adding companies asks for one client first", async () => {
    await withScope({ ids: ["manch", "acme"], active: null, choices: [], all: false }, async () => {
      await expect(ingestRows([{ company: "Z", domain: "z.com" }], { source: "manual" })).rejects.toThrow(/Pick a client/);
    });
  });
});

describe("Accounts page: switching between client accounts", () => {
  it("a person with several accounts gets one card each, counted only from that account", async () => {
    await baseDb.userClient.create({ data: { userId: "u1", clientId: "manch" } });
    const { accountCards } = await import("@/lib/clients");
    const scope = await scopeFor("asha@trilliantdigital.com", false, null);
    const cards = await accountCards(scope);
    expect(cards.map((c) => c.name)).toEqual(["Acme", "Manch"]);
    expect(cards.find((c) => c.id === "acme")).toMatchObject({ companies: 1, people: 1 });
    expect(cards.find((c) => c.id === "manch")).toMatchObject({ companies: 1, people: 1 });
  });

  it("only assigned accounts appear; picking an account you're not on opens nothing from it", async () => {
    const { accountCards } = await import("@/lib/clients");
    const scope = await scopeFor("asha@trilliantdigital.com", false, "manch"); // tampered pick
    expect((await accountCards(scope)).map((c) => c.id)).toEqual(["acme"]);
    // The tampered pick is ignored: the request stays inside Acme.
    expect(scope.ids).toEqual(["acme"]);
    await withScope(scope, async () => {
      expect((await db.account.findMany()).map((x) => x.name)).toEqual(["Acme Target"]);
    });
  });

  it("switching accounts changes every query at once: nothing from the previous account remains", async () => {
    await baseDb.userClient.create({ data: { userId: "u1", clientId: "manch" } });
    const inAcme = await scopeFor("asha@trilliantdigital.com", false, "acme");
    const inManch = await scopeFor("asha@trilliantdigital.com", false, "manch");
    await withScope(inAcme, async () => expect((await db.contact.findMany()).map((c) => c.fullName)).toEqual(["Ana A"]));
    await withScope(inManch, async () => {
      expect((await db.contact.findMany()).map((c) => c.fullName)).toEqual(["Ravi M"]);
      expect(await db.task.count()).toBe(1);
    });
  });
});
