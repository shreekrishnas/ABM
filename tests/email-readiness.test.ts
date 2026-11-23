// P6: email readiness. One checklist per client, built from what the send step requires; the send
// step holds a client's approved emails with exactly what is missing; nothing is ever sent here
// (mock adapters).
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { baseDb } from "@/lib/db-base";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { emailReadiness } from "@/lib/email/readiness";
import { sendApproved } from "@/lib/pipeline/stages/engagement";
import { newContext } from "@/lib/pipeline/context";
import { setAiPaused } from "@/lib/admin/ai-pause";

beforeAll(() => setAdapters(createMockAdapters()));
const prevMode = process.env.ADAPTER_MODE;
afterEach(() => { process.env.ADAPTER_MODE = prevMode; });

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  // Manch: a complete Account Brain with sender details (built in). Beta: no Account Brain yet.
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "beta", name: "Beta" }] });
  await baseDb.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  await baseDb.sequence.create({ data: { name: "T1", tier: "T1", steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
});

const keysMissing = async (id: string) => (await emailReadiness(id)).items.filter((i) => i.blocking && !i.ok).map((i) => i.key);

describe("the readiness checklist", () => {
  it("a fully set-up client is ready; the approval rule and AI state are information, not blockers", async () => {
    const r = await emailReadiness("manch");
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.items.find((i) => i.key === "approval")).toMatchObject({ blocking: false, ok: true });
    await setAiPaused(true, "ops@trilliantdigital.com");
    expect((await emailReadiness("manch")).ready).toBe(true);
    expect((await emailReadiness("manch")).items.find((i) => i.key === "ai")).toMatchObject({ ok: false, blocking: false, detail: expect.stringMatching(/approved ones can still go out/) });
    await setAiPaused(false, "ops@trilliantdigital.com");
  });

  it("names each missing piece with how to fix it", async () => {
    expect(await keysMissing("beta")).toEqual(["brain", "sender", "postal_address"]);
    await baseDb.mailbox.updateMany({ data: { active: false } });
    expect(await keysMissing("manch")).toEqual(["mailbox"]);
    await baseDb.mailbox.updateMany({ data: { active: true } });
    await baseDb.client.update({ where: { id: "manch" }, data: { status: "paused" } });
    expect(await keysMissing("manch")).toEqual(["client_active"]);
    await baseDb.client.update({ where: { id: "manch" }, data: { status: "active" } });
    await baseDb.reviewItem.create({ data: { type: "bounce_breaker", stage: 12, reason: "Hard bounces above 5% in 7 days" } });
    expect(await keysMissing("manch")).toEqual(["bounce_breaker"]);
    await baseDb.reviewItem.deleteMany();
    await baseDb.sequenceStep.deleteMany();
    expect(await keysMissing("manch")).toEqual(["sequence"]);
    const postal = (await emailReadiness("beta")).items.find((i) => i.key === "postal_address")!;
    expect(postal.fix).toMatch(/postal address/);
    expect(postal.href).toBe("/brain");
  });

  it("outside sample mode, a missing SMTP connection is a blocker", async () => {
    const prev = process.env.SMTP_URL;
    process.env.ADAPTER_MODE = "live";
    delete process.env.SMTP_URL;
    expect(await keysMissing("manch")).toEqual(["connection"]);
    process.env.SMTP_URL = "smtp://user:pass@mail.test:587";
    expect(await keysMissing("manch")).toEqual([]);
    if (prev === undefined) delete process.env.SMTP_URL; else process.env.SMTP_URL = prev;
  });
});

describe("the send step holds a client that isn't ready, and says exactly why", () => {
  it("approved emails of a client without a mailbox wait, with the reason recorded; nothing is sent", async () => {
    const a = await baseDb.account.create({ data: { name: "Acme", sellerId: "manch", domain: "acme.example" } });
    const c = await baseDb.contact.create({ data: { accountId: a.id, fullName: "Ada Acme", email: "ada@acme.example" } });
    await baseDb.draft.create({ data: { contactId: c.id, subject: "Hello", body: "Hi Ada", claims: [], status: "approved" } });
    await baseDb.mailbox.deleteMany();
    const r = await sendApproved(newContext());
    expect(r.sent).toBe(0);
    expect(r.held).toBe(1);
    expect(r.reasons).toEqual(["manch: Not ready to send: missing a sending mailbox with a daily limit"]);
    expect(await baseDb.message.count()).toBe(0);
    const ev = await baseDb.pipelineEvent.findFirstOrThrow({ where: { step: "sequence_send.readiness" } });
    expect(ev).toMatchObject({ outcome: "block", accountId: a.id, reason: "Not ready to send: missing a sending mailbox with a daily limit" });
  });
});
