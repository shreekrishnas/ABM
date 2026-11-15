// Website visitors are dated by their real visit to our site, not by when they were saved to the Apollo list.
import { afterEach, describe, expect, it, vi } from "vitest";
import { apolloDate, apolloVisitDates, visitToSite } from "@/lib/adapters/live/apollo";

describe("reading Apollo's dates", () => {
  it("understands 20261031 (number or text) and ISO timestamps", () => {
    expect(apolloDate(20261031)?.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(apolloDate("20260924")?.toISOString().slice(0, 10)).toBe("2026-09-24");
    expect(apolloDate("2026-10-31T11:45:12Z")?.toISOString()).toBe("2026-10-31T11:45:12.000Z");
    expect(apolloDate(null)).toBeNull();
    expect(apolloDate("not a date")).toBeNull();
  });
});

describe("the visit to our site", () => {
  const intent = {
    last_visited_at: 20261105,
    last_visited_at_datetime: "2026-11-05T09:00:00Z",
    domain_aggregates: [
      { domain: "othersite.com", last_visit: 20261105 },
      { domain: "www.oursite.com", last_visit: 20261012 },
    ],
  };

  it("uses our site's own date, not the combined one", () => {
    const v = visitToSite(intent, "https://oursite.com/en/");
    expect(v).not.toBe("other_site");
    expect(v && v !== "other_site" ? v.at.toISOString().slice(0, 10) : null).toBe("2026-10-12");
  });

  it("a company that only visited another tracked site is marked as such", () => {
    expect(visitToSite({ domain_aggregates: [{ domain: "othersite.com", last_visit: 20261020 }] }, "oursite.com")).toBe("other_site");
  });

  it("without a per-site breakdown, the combined date is used; without anything, nothing", () => {
    const v = visitToSite({ last_visited_at_datetime: "2026-10-01T10:00:00Z" }, "oursite.com");
    expect(v && v !== "other_site" ? v.at.toISOString() : null).toBe("2026-10-01T10:00:00.000Z");
    expect(visitToSite(null, "oursite.com")).toBeNull();
    expect(visitToSite({}, "oursite.com")).toBeNull();
  });
});

describe("asking Apollo for the dates", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks in batches of 100 domains and maps each company's date by domain", async () => {
    const domains = Array.from({ length: 150 }, (_, i) => `co${i}.in`);
    const bodies: { q_organization_domains_list: string[] }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      const organizations = body.q_organization_domains_list.map((d: string, i: number) => ({
        primary_domain: d,
        intent_signal_account: i % 2 ? { domain_aggregates: [{ domain: "othersite.com", last_visit: 20261020 }] } : { domain_aggregates: [{ domain: "oursite.com", last_visit: 20261015 }] },
      }));
      return new Response(JSON.stringify({ organizations }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const dates = await apolloVisitDates("dummy-key", [...domains, "https://www.co0.in/"], "oursite.com");
    expect(bodies.map((b) => b.q_organization_domains_list.length)).toEqual([100, 50]);
    const first = dates.get("co0.in");
    expect(first && first !== "other_site" ? first.at.toISOString().slice(0, 10) : null).toBe("2026-10-15");
    expect(dates.get("co1.in")).toBe("other_site");
    expect(dates.size).toBe(150);
  });
});
