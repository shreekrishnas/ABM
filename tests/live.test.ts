import { afterEach, describe, expect, it, vi } from "vitest";
import { WebResearch, classifySource, queryFor } from "@/lib/adapters/live/research";
import { OpenRouterLLM } from "@/lib/adapters/live/openrouter";
import { ApiError, parseLooseDate } from "@/lib/adapters/live/http";
import { createAdapters, serviceStatus } from "@/lib/adapters";
import { evidenceGate } from "@/lib/pipeline/gates";

// External APIs are never called in tests: fetch is stubbed per test.

type Handler = (url: string, init: RequestInit) => { status?: number; body: unknown };

function stubFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();

describe("live research", () => {
  it("builds seller-specific queries and classifies sources", () => {
    expect(queryFor("trigger", "Kaveri Foods").q).toContain('"Kaveri Foods"');
    expect(queryFor("trigger", "Kaveri Foods").news).toBe(true);
    expect(classifySource("https://kaverifoods.in/about", "kaverifoods.in")).toBe("official");
    expect(classifySource("https://careers.kaverifoods.in/jobs/1", "kaverifoods.in")).toBe("careers");
    expect(classifySource("https://www.prnewswire.com/x", "kaverifoods.in")).toBe("press");
    expect(classifySource("https://economictimes.com/x", "kaverifoods.in")).toBe("news");
  });

  it("main pass uses Exa, drops undated and irrelevant pages", async () => {
    const calls = stubFetch((url) => {
      expect(url).toBe("https://api.exa.ai/search");
      return {
        body: {
          results: [
            { url: "https://news.example/a", title: "Kaveri Foods expands distributor network", publishedDate: recent, text: "Kaveri Foods adds 2,000 distributors." },
            { url: "https://news.example/b", title: "Undated page about Kaveri", text: "Kaveri Foods" },
            { url: "https://news.example/c", title: "Unrelated company news", publishedDate: recent, text: "Something else entirely." },
          ],
        },
      };
    });
    const r = new WebResearch({ exa: "exa-test", tavily: "tv-test", serp: "serp-test" });
    const pages = await r.search("kaverifoods.in", "Kaveri Foods", "trigger", "main");
    expect(calls).toHaveLength(1);
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("exa-test");
    expect(pages.map((p) => p.url)).toEqual(["https://news.example/a"]);
    expect(pages[0].sourceType).toBe("news");
  });

  it("falls back to the next engine when one fails or finds nothing", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("exa.ai")) return { status: 401, body: { error: "invalid key" } };
      return { body: { results: [{ url: "https://news.example/t", title: "Kaveri Foods SAP move", content: "Kaveri Foods starts S/4HANA migration.", published_date: "Mon, 28 Sep 2026 10:00:00 GMT" }] } };
    });
    const r = new WebResearch({ exa: "exa-test", tavily: "tv-test" });
    const pages = await r.search("kaverifoods.in", "Kaveri Foods", "trigger", "main");
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["api.exa.ai", "api.tavily.com"]);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer tv-test");
    expect(pages).toHaveLength(1);
    expect(pages[0].publishedAt.toISOString().slice(0, 10)).toBe("2026-09-28");
  });

  it("follow-up pass prefers SerpAPI as an independent second source", async () => {
    const calls = stubFetch(() => ({ body: { news_results: [{ link: "https://news.example/s", title: "Kaveri Foods acquires rival", snippet: "Kaveri Foods acquired...", date: "3 days ago" }] } }));
    const r = new WebResearch({ exa: "exa-test", serp: "serp-test" });
    const pages = await r.search("kaverifoods.in", "Kaveri Foods", "trigger", "followup");
    expect(new URL(calls[0].url).hostname).toBe("serpapi.com");
    expect(new URL(calls[0].url).searchParams.get("tbm")).toBe("nws");
    expect(pages).toHaveLength(1);
  });

  it("raises when every engine fails, without leaking the key", async () => {
    stubFetch(() => ({ status: 403, body: "forbidden" }));
    const r = new WebResearch({ serp: "serp-secret" });
    const err = await r.search("kaverifoods.in", "Kaveri Foods", "trigger", "followup").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(String(err.message)).not.toContain("serp-secret");
  });
});

describe("live LLM (OpenRouter)", () => {
  const llmReply = (content: unknown) => ({ body: { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] } });
  const page = (url: string) => ({ url, title: "Kaveri Foods news", publishedAt: new Date(recent), text: "Kaveri Foods is migrating to SAP S/4HANA.", sourceType: "news" as const });

  it("takes source URL and date from the page, never from the model", async () => {
    const calls = stubFetch(() => llmReply({ items: [
      { page: 0, claim: "Kaveri Foods is migrating to SAP S/4HANA.", value: null, kind: null },
      { page: 7, claim: "Kaveri Foods made up fact on a page that does not exist.", value: null },
    ] }));
    const llm = new OpenRouterLLM("or-test", "openai/gpt-4o-mini");
    const out = await llm.extractEvidence([page("https://news.example/a")], "trigger");
    expect(out).toHaveLength(1);
    expect(out[0].sourceUrl).toBe("https://news.example/a");
    expect(out[0].publishedAt.toISOString()).toBe(recent);
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.model).toBe("openai/gpt-4o-mini");
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer or-test");
  });

  it("drops negative items with an unknown kind and normalises values", async () => {
    stubFetch((_, init) => {
      const prompt = String(init.body);
      if (prompt.includes("Question: negative")) return llmReply({ items: [{ page: 0, claim: "Kaveri Foods had a rough quarter.", kind: "bad_vibes" }, { page: 0, claim: "Kaveri Foods announced layoffs.", kind: "layoffs" }] });
      return llmReply({ items: [{ page: 0, claim: "Kaveri Foods works with 4,500 distributors.", value: "about 4,500" }] });
    });
    const llm = new OpenRouterLLM("or-test");
    const neg = await llm.extractEvidence([page("https://news.example/n")], "negative");
    expect(neg.map((n) => n.negativeKind)).toEqual(["layoffs"]);
    const net = await llm.extractEvidence([page("https://news.example/p")], "partner_network");
    expect(net[0].value).toBe("4500");
  });

  it("rejects malformed model output", async () => {
    stubFetch(() => llmReply("not json at all"));
    await expect(new OpenRouterLLM("or-test").classifyReply("hi")).rejects.toThrow(/non-JSON/);
    stubFetch(() => llmReply({ class: "maybe" }));
    await expect(new OpenRouterLLM("or-test").classifyReply("hi")).rejects.toThrow();
  });

  it("drafts append the compliance footer in code", async () => {
    stubFetch(() => llmReply({ subject: "Distributor onboarding at Kaveri", body: "Hi Asha, saw Kaveri Foods is moving to S/4HANA. Manch helps onboard distributors faster. Worth a short call?", claims: [{ text: "Kaveri Foods is moving to S/4HANA", factIds: ["f1"] }] }));
    const d = await new OpenRouterLLM("or-test").draft({
      firstName: "Asha", title: "Head of Master Data", company: "Kaveri Foods", stepOrder: 1, instruction: "First touch",
      facts: [{ id: "f1", key: "trigger", claim: "Kaveri Foods is migrating to SAP S/4HANA." }],
      sender: { name: "Rep", company: "Manch Technologies", address: "Bengaluru, India" },
      seller: { name: "Manch Technologies", pitch: "Manch onboards partners faster.", cta: "Worth a short call?", useCase: "distributor_onboarding" },
    }, 1);
    expect(d.body).toContain("Manch Technologies · Bengaluru, India");
    expect(d.body).toMatch(/unsubscribe/i);
    expect(d.claims[0].factIds).toEqual(["f1"]);
  });
});

describe("adapter selection", () => {
  it("goes live per service only when its key is set", () => {
    vi.stubEnv("ADAPTER_MODE", "");
    vi.stubEnv("EXA_API_KEY", "exa-test");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const a = createAdapters();
    expect(a.research.live).toBe(true);
    expect(a.llm).not.toBeInstanceOf(OpenRouterLLM);
    const s = Object.fromEntries(serviceStatus().map((x) => [x.key, x.mode]));
    expect(s).toMatchObject({ research: "live", llm: "mock", provider: "mock", email: "mock" });
  });

  it("ADAPTER_MODE=mock forces every service onto mocks", () => {
    vi.stubEnv("ADAPTER_MODE", "mock");
    vi.stubEnv("EXA_API_KEY", "exa-test");
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
    const a = createAdapters();
    expect(a.research.live).toBeFalsy();
    expect(a.llm).not.toBeInstanceOf(OpenRouterLLM);
  });

  it("evidence gate refuses mock evidence when research is live", () => {
    const e = { key: "trigger", claim: "x", sourceUrl: "https://a.example", sourceType: "mock", publishedAt: new Date(recent) };
    expect(evidenceGate(e, "mock").pass).toBe(true);
    expect(evidenceGate(e, "live").pass).toBe(false);
  });

  it("parses loose dates", () => {
    const now = new Date("2026-10-06T00:00:00Z");
    expect(parseLooseDate("2 days ago", now)?.toISOString().slice(0, 10)).toBe("2026-10-04");
    expect(parseLooseDate("10/01/2026, 07:00 AM, +0000 UTC", now)?.toISOString()).toBe("2026-10-01T07:00:00.000Z");
    expect(parseLooseDate("09/30/2026, 12:15 PM, +0000 UTC", now)?.toISOString()).toBe("2026-09-30T12:15:00.000Z");
    expect(parseLooseDate("09/30/2026, 12:15 AM, +0000 UTC", now)?.toISOString()).toBe("2026-09-30T00:15:00.000Z");
    expect(parseLooseDate("garbage", now)).toBeNull();
    expect(parseLooseDate(undefined, now)).toBeNull();
  });
});
