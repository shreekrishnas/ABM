// The writer learns from the team: edits become lessons and good examples, rejections become lessons.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { editLessons, learnFromReview, teamLessons } from "@/lib/knowledge/rag/learn";

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.create({ data: { id: "test", name: "Test" } });
});

const before = { subject: "Test Pharma + Test Co", body: "Hi Asha,\n\nTest Pharma announced its SAP S/4HANA migration.\n\nIt looks like your team is busy with this.\n\nWorth a 20-minute call?" };
const after = { subject: "Vendor data before cut-over", body: "Hi Asha,\n\nTest Pharma announced its SAP S/4HANA migration.\n\nClean vendor data before cut-over saves months of fixes later.\n\nWorth a 20-minute call?" };
const draft = (id: string) => ({ id, sellerId: "test", stepOrder: 1, useCase: "vendor_onboarding", knowledge: { play: "email_first", persona: "cpo" }, contactTitle: "Head of Procurement" });

describe("lessons from an edit", () => {
  it("names the subject change, what was cut and what was written instead", () => {
    const l = editLessons(before, after);
    expect(l[0]).toMatch(/Subject "Test Pharma \+ Test Co" was changed to "Vendor data before cut-over"/);
    expect(l).toContain('The team cut: "It looks like your team is busy with this."');
    expect(l).toContain('The team wrote instead: "Clean vendor data before cut-over saves months of fixes later."');
    expect(l.join(" ")).not.toMatch(/SAP S\/4HANA migration/); // unchanged sentences aren't lessons
  });
});

describe("saving and using lessons", () => {
  it("an approved edit and a rejection both become lessons for that client only, newest first", async () => {
    await learnFromReview(draft("d1"), { decision: "approve", edited: true, note: null, before, after });
    await learnFromReview(draft("d2"), { decision: "reject", edited: false, note: "Too salesy for a CFO", before, after: before });
    const lessons = await teamLessons("test");
    expect(lessons[0]).toMatch(/rejected because: "Too salesy for a CFO"/);
    expect(lessons.some((x) => x.startsWith("The team cut:"))).toBe(true);
    expect(await teamLessons("other-client")).toEqual([]);
    // Kept in the knowledge base where the team can see them.
    expect(await baseDb.knowledgeDoc.count({ where: { sellerId: "test", key: { startsWith: "lesson:draft:" } } })).toBe(2);
  });

  it("approving without changes or a note teaches nothing", async () => {
    expect(await learnFromReview(draft("d3"), { decision: "approve", edited: false, note: null, before, after: before })).toEqual([]);
    expect(await teamLessons("test")).toEqual([]);
  });
});
