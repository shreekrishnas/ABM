// Research precision helpers: pure functions, no database.
import { describe, expect, it } from "vitest";
import { canonicalUrl, eventDateFrom, factConfidence, namesCompany, ownSiteTier, similarity, SAME_REPORT, sizesDisagree, statedEmployees } from "@/lib/research/precision";
import { classifySource } from "@/lib/adapters/live/research";

describe("canonical links", () => {
  it("one article under tracking links, AMP, www and a trailing slash is one source", () => {
    const a = canonicalUrl("https://www.example.com/news/acme-plant/?utm_source=x&fbclid=y#top");
    expect(canonicalUrl("https://example.com/news/acme-plant")).toBe(a);
    expect(canonicalUrl("https://amp.example.com/news/acme-plant/amp")).toBe(a);
    expect(canonicalUrl("https://m.example.com/news/acme-plant.amp")).not.toBe("");
  });
  it("keeps real query parameters", () => {
    expect(canonicalUrl("https://example.com/story?id=42&utm_medium=mail")).toBe("https://example.com/story?id=42");
  });
});

describe("source strength", () => {
  it("own-site press, investor and about pages are official; blogs are the company site; careers are careers", () => {
    expect(ownSiteTier("/press/2026/new-plant")).toBe("official");
    expect(ownSiteTier("/investors/annual-report")).toBe("official");
    expect(ownSiteTier("/")).toBe("official");
    expect(ownSiteTier("/blog/why-mdm-matters")).toBe("company_site");
    expect(ownSiteTier("/careers/data-lead")).toBe("careers");
  });
  it("unknown sites are web pages, wire services are press, known publishers are news", () => {
    expect(classifySource("https://someblog.io/post", "acme.com")).toBe("web");
    expect(classifySource("https://www.prnewswire.com/x", "acme.com")).toBe("press");
    expect(classifySource("https://economictimes.indiatimes.com/x", "acme.com")).toBe("news");
    expect(classifySource("https://acme.com/blog/x", "acme.com")).toBe("company_site");
  });
});

describe("event dates", () => {
  const page = new Date("2026-11-01T00:00:00Z");
  it("reads full dates, month and year, and past years", () => {
    expect(eventDateFrom("Acme opened its plant on 12 March 2025.", page)?.toISOString().slice(0, 10)).toBe("2025-03-12");
    expect(eventDateFrom("In March 2024 Acme moved to SAP.", page)?.toISOString().slice(0, 7)).toBe("2024-03");
    expect(eventDateFrom("Acme has used SAP since 2021.", page)?.getUTCFullYear()).toBe(2021);
  });
  it("gives nothing when the sentence has no date, and never a date after the page", () => {
    expect(eventDateFrom("Acme is hiring a data lead.", page)).toBeNull();
    expect(eventDateFrom("Acme will open a plant on 5 January 2030.", page)).toBeNull();
  });
});

describe("right company", () => {
  const page = (text: string, url = "https://news.example.com/a") => ({ url, title: "", text });
  it("needs the brand words, not just one of them", () => {
    expect(namesCompany("Trident Auto Components Pvt Ltd", null, page("Trident Auto announced a new plant.")).pass).toBe(true);
    expect(namesCompany("Trident Auto Components Pvt Ltd", null, page("Trident Group posted results.")).pass).toBe(false);
  });
  it("the company's own domain counts", () => {
    expect(namesCompany("Acme Industries", "acme.in", page("Our new plant", "https://www.acme.in/press")).pass).toBe(true);
  });
  it("matches whole words only", () => {
    expect(namesCompany("Indo Amines Ltd", null, page("Indoamines and others")).pass).toBe(false);
  });
});

describe("duplicate reports", () => {
  it("a reworded copy of the same story scores as the same report", () => {
    const a = "Acme Pharma said it will add 3,000 distributors across East India this year to expand rural reach.";
    const b = "Acme Pharma will add 3,000 distributors across East India this year to expand rural reach, the company said.";
    expect(similarity(a, b)).toBeGreaterThanOrEqual(SAME_REPORT);
    expect(similarity(a, "Acme Pharma appointed a new CFO.")).toBeLessThan(SAME_REPORT);
  });
});

describe("headcount", () => {
  it("reads stated sizes and takes the lower end of a band", () => {
    expect(statedEmployees("Acme employs about 5,200 employees.")).toBe(5200);
    expect(statedEmployees("Company size: 1,001-5,000 employees")).toBe(1001);
    expect(statedEmployees("a team of 2.5k people")).toBe(2500);
    expect(statedEmployees("Founded in 1998")).toBeNull();
  });
  it("two sizes disagree only beyond a factor of two", () => {
    expect(sizesDisagree(6000, 9000)).toBe(false);
    expect(sizesDisagree(6000, 900)).toBe(true);
  });
});

describe("confidence", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  const base = { status: "probable", fullText: true, publishedAt: new Date("2026-10-20T00:00:00Z"), reports: 1, freshDays: 120, hasQuote: true, quoteExact: true };
  it("official beats web; more independent sources, more confidence", () => {
    expect(factConfidence({ ...base, sourceType: "official" }, now)).toBeGreaterThan(factConfidence({ ...base, sourceType: "web" }, now));
    expect(factConfidence({ ...base, sourceType: "news", reports: 2 }, now)).toBeGreaterThan(factConfidence({ ...base, sourceType: "news" }, now));
  });
  it("snippets, undated pages and age lower it; a team check is high; values stay within 5–99", () => {
    expect(factConfidence({ ...base, sourceType: "news", fullText: false }, now)).toBeLessThan(factConfidence({ ...base, sourceType: "news" }, now));
    expect(factConfidence({ ...base, sourceType: "news", publishedAt: new Date("2026-01-01T00:00:00Z") }, now)).toBeLessThan(factConfidence({ ...base, sourceType: "news" }, now));
    expect(factConfidence({ ...base, sourceType: "team" }, now)).toBe(95);
    for (const t of ["official", "web", "careers", "team"]) {
      const c = factConfidence({ ...base, sourceType: t, reports: 5 }, now);
      expect(c).toBeGreaterThanOrEqual(5);
      expect(c).toBeLessThanOrEqual(99);
    }
  });
});
