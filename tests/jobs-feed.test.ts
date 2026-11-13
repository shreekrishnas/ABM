// Careers job lists (Greenhouse, Lever, Ashby, Workable): pure parsing and matching, no network.
import { describe, expect, it } from "vitest";
import { careersLinks, detectAts, feedUrl, matchesRole, parseJobs, readCareers, roleWords } from "@/lib/signals/jobs";
import { MANCH } from "@/lib/seller/manch";

describe("finding the careers system", () => {
  it("recognises each system's links", () => {
    expect(detectAts('<a href="https://boards.greenhouse.io/acmecorp">Jobs</a>')).toEqual({ ats: "greenhouse", slug: "acmecorp" });
    expect(detectAts('<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>')?.slug).toBe("acme");
    expect(detectAts("https://jobs.lever.co/zippy/123")?.ats).toBe("lever");
    expect(detectAts("https://jobs.ashbyhq.com/quick-co")?.slug).toBe("quick-co");
    expect(detectAts('<a href="https://bigco.workable.com/">')?.ats).toBe("workable");
    expect(detectAts('<a href="/careers">Careers</a>')).toBeNull();
  });
  it("finds careers links on a homepage", () => {
    expect(careersLinks('<a href="/join-us">Join us</a><a href="/about">About</a>', "https://x.com/")).toEqual(["https://x.com/join-us"]);
  });
  it("points at each system's public job list", () => {
    expect(feedUrl("lever", "zippy")).toContain("api.lever.co/v0/postings/zippy");
  });
});

describe("reading job lists", () => {
  it("reads each system's shape", () => {
    const gh = parseJobs("greenhouse", { jobs: [{ title: "Head of Master Data", absolute_url: "https://b/1", location: { name: "Mumbai" }, updated_at: "2026-11-01T10:00:00Z" }] });
    expect(gh[0]).toMatchObject({ title: "Head of Master Data", location: "Mumbai" });
    expect(parseJobs("lever", [{ text: "SAP MM Consultant", hostedUrl: "https://l/1", categories: { location: "Pune" }, createdAt: 1793000000000 }])[0].location).toBe("Pune");
    expect(parseJobs("ashby", { jobs: [{ title: "Data Governance Lead", jobUrl: "https://a/1", location: "Bengaluru" }] })[0].title).toBe("Data Governance Lead");
    expect(parseJobs("workable", { jobs: [{ title: "Procurement Operations Manager", url: "https://w/1" }] })).toHaveLength(1);
  });
  it("an unknown shape gives an empty list, never an error", () => {
    expect(parseJobs("greenhouse", { nope: 1 })).toEqual([]);
    expect(parseJobs("lever", null)).toEqual([]);
  });
});

describe("matching roles", () => {
  const words = ["cio", "master data", "s/4hana", "procurement operations"];
  it("matches whole words of the client's roles", () => {
    expect(matchesRole("Head of Master Data Governance", words)).toBe("master data");
    expect(matchesRole("SAP S/4HANA Functional Lead", words)).toBe("s/4hana");
    expect(matchesRole("Socio-economic Analyst", words)).toBeNull();
  });
  it("role words come from the Account Brain", () => {
    const w = roleWords(MANCH);
    expect(w).toContain("master data");
    expect(w.every((x) => x === x.toLowerCase())).toBe(true);
  });
});

describe("reading a company's careers site", () => {
  it("records 'none' when no system is linked, and reads the list when one is", async () => {
    const none = await readCareers("plain.example", { html: async (u) => ({ html: "<a href='/about'>About</a>", finalUrl: u }), json: async () => ({}) });
    expect(none.status).toBe("none");
    const found = await readCareers("acme.example", {
      html: async (u) => ({ html: '<a href="https://boards.greenhouse.io/acme">Careers</a>', finalUrl: u }),
      json: async () => ({ jobs: [{ title: "Chief Data Officer", absolute_url: "https://b/9" }] }),
    });
    expect(found).toMatchObject({ status: "found", ats: "greenhouse", slug: "acme" });
    expect(found.jobs[0].title).toBe("Chief Data Officer");
  });
  it("a failing job list is an error result, not a crash", async () => {
    const r = await readCareers("acme.example", { html: async (u) => ({ html: "https://jobs.lever.co/acme", finalUrl: u }), json: async () => { throw new Error("503"); } });
    expect(r.status).toBe("error");
  });
});
