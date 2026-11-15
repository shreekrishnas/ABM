// "Is this the right person?": titles written differently are the same title, an email on the
// company's own domain shows the employer, and the people already waiting can be re-checked for free.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { emailOnCompanyDomain, titlesAgree } from "@/lib/pipeline/gates";
import { recheckWaitingPeople } from "@/lib/admin/cleanup";

describe("titles that say the same thing", () => {
  it.each([
    ["AVP IT", "Associate Vice President - IT - Sales and Marketing"],
    ["Chief Operations Officer", "Chief Operating Officer"],
    ["Associate Vice President – IT", "Associate Vice President - IT"],
    ["Group C.F.O", "Chief Financial Officer"],
    ["Sr. VP Finance", "Senior Vice President, Finance"],
    ["IT Head", "Head - IT"],
  ])("%s = %s", (a, b) => expect(titlesAgree(a, b)).toBe(true));

  it.each([
    ["Sr. Vice President - Operation", "Ipqa"],
    ["Chief Technology Officer", "Chief Information Officer"],
    ["Vice President Sales", "Vice President Finance"],
    ["Head of IT", "Head of Finance"],
    ["Director", "Managing Director"],
  ])("%s ≠ %s", (a, b) => expect(titlesAgree(a, b)).toBe(false));
});

describe("employer from the email domain", () => {
  it("counts the company's own domain and its sub-domains only", () => {
    expect(emailOnCompanyDomain("ravi@testco.in", "testco.in")).toBe(true);
    expect(emailOnCompanyDomain("ravi@mail.testco.in", "www.testco.in")).toBe(true);
    expect(emailOnCompanyDomain("ravi@gmail.com", "testco.in")).toBe(false);
    expect(emailOnCompanyDomain(null, "testco.in")).toBe(false);
  });
});

describe("re-checking people already waiting", () => {
  let accountId = "";
  const person = async (name: string, o: { email?: string | null; title: string; fields: Record<string, string>; providerTitle?: string | null }) => {
    const c = await baseDb.contact.create({ data: { accountId, fullName: name, email: o.email ?? null, title: o.title, titleNormalized: o.title, readiness: "human_review", readinessReasons: ["Title unknown"] } });
    for (const [field, status] of Object.entries(o.fields)) await baseDb.fieldState.create({ data: { contactId: c.id, field, status: status as "verified", source: "provider" } });
    await baseDb.reviewItem.create({ data: { type: "identity_conflict", stage: 4, accountId, contactId: c.id, reason: `${name}: check`, payload: { providerTitle: o.providerTitle ?? null } } });
    return c;
  };

  beforeEach(async () => {
    const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
    await baseDb.client.create({ data: { id: "test", name: "Test" } });
    accountId = (await baseDb.account.create({ data: { name: "Test Pharma", domain: "testpharma.in", sellerId: "test", pipelineStatus: "idle" } })).id;
  });

  it("confirms same-title and company-email people, keeps real mismatches and missing emails, deletes nothing", async () => {
    const same = await person("Same Title", { email: "same@testpharma.in", title: "Chief Operations Officer", providerTitle: "Chief Operating Officer", fields: { email: "probable", title: "conflicting", company: "verified" } });
    const byEmail = await person("Company Email", { email: "ce@testpharma.in", title: "Head of Data and AI", fields: { email: "probable", title: "unknown", company: "unknown" } });
    const real = await person("Real Mismatch", { email: "rm@testpharma.in", title: "Sr. Vice President - Operation", providerTitle: "Ipqa", fields: { email: "probable", title: "conflicting", company: "verified" } });
    const noEmail = await person("No Email", { email: null, title: "Chief Information Officer", fields: { email: "unknown", title: "unknown", company: "unknown" } });
    const gmail = await person("Gmail User", { email: "gu@gmail.com", title: "CFO", fields: { email: "probable", title: "unknown", company: "unknown" } });

    const r = await recheckWaitingPeople("test");
    expect(r.checked).toBe(5);
    expect(r.confirmed.sort()).toEqual(["Company Email", "Same Title"]);
    expect(r.stillWaiting.map((x) => x.name).sort()).toEqual(["Gmail User", "No Email", "Real Mismatch"]);
    expect(r.stillWaiting.find((x) => x.name === "Real Mismatch")?.why).toMatch(/Ipqa/);
    expect(r.stillWaiting.find((x) => x.name === "No Email")?.why).toMatch(/no email/);

    const field = async (id: string, f: string) => (await baseDb.fieldState.findUniqueOrThrow({ where: { contactId_field: { contactId: id, field: f } } })).status;
    expect(await field(same.id, "title")).toBe("verified");
    expect(await field(byEmail.id, "company")).toBe("probable");
    expect(await field(byEmail.id, "title")).toBe("probable");
    expect(await field(real.id, "title")).toBe("conflicting");
    expect(await field(gmail.id, "company")).toBe("unknown");

    // Confirmed items are resolved (kept for the record); the rest stay open.
    const items = await baseDb.reviewItem.findMany({ select: { contactId: true, status: true } });
    expect(items).toHaveLength(5);
    const status = (id: string) => items.find((i) => i.contactId === id)?.status;
    expect([status(same.id), status(byEmail.id)]).toEqual(["resolved", "resolved"]);
    expect([status(real.id), status(noEmail.id), status(gmail.id)]).toEqual(["open", "open", "open"]);

    // Their company continues from the people step.
    expect(await baseDb.account.findUniqueOrThrow({ where: { id: accountId } })).toMatchObject({ pipelineStatus: "queued", queuedFromStage: 8 });
    expect(r.companies).toBe(1);
  });

  it("only touches the client asked for", async () => {
    await baseDb.client.create({ data: { id: "test-b", name: "Test B" } });
    const other = await baseDb.account.create({ data: { name: "Other Co", domain: "otherco.in", sellerId: "test-b" } });
    const c = await baseDb.contact.create({ data: { accountId: other.id, fullName: "Other Person", email: "op@otherco.in", title: "CFO" } });
    await baseDb.fieldState.create({ data: { contactId: c.id, field: "company", status: "unknown" } });
    await baseDb.reviewItem.create({ data: { type: "identity_conflict", stage: 4, accountId: other.id, contactId: c.id, reason: "x" } });
    const r = await recheckWaitingPeople("test");
    expect(r.checked).toBe(0);
    expect((await baseDb.reviewItem.findFirstOrThrow({ where: { contactId: c.id } })).status).toBe("open");
  });
});
