// Website visitors without a real visit date are listed apart and never land in a date range as "today".
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { UNKNOWN_DATE_TITLE } from "@/lib/web/visits";
import { listVisitorCompanies, visitorFreshness } from "@/lib/web/visitor-prospects";

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
});

const visit = (name: string, at: string, title = "Visited the website (seen by Apollo)") =>
  baseDb.webVisit.create({ data: { companyName: name, companyDomain: `${name.toLowerCase().replace(/\s/g, "")}.in`, url: "https://apollo.io/website-visitors", path: "/website-visitors", title, topic: "general", source: "apollo", occurredAt: new Date(at) } });

describe("visit dates", () => {
  it("a date range shows only dated visits; undated ones are listed apart", async () => {
    await visit("October Co", "2026-10-12T10:00:00Z");
    await visit("Undated Co", "2026-11-15T07:44:00Z", UNKNOWN_DATE_TITLE);
    const nov = await listVisitorCompanies(new Date("2026-11-01"), new Date("2026-11-30"));
    expect(nov.map((c) => c.name)).toEqual([]);
    const oct = await listVisitorCompanies(new Date("2026-10-01"), new Date("2026-10-31"));
    expect(oct.map((c) => c.name)).toEqual(["October Co"]);
    const f = await visitorFreshness();
    expect(f.newestVisit?.toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(f.undated).toEqual(["Undated Co"]);
  });
});
