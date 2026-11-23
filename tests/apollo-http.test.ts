// P5: Apollo goes through the shared external-API helper: retries on rate limits and server errors,
// none on a refused key, a clear message either way, and the visitor list read through every page.
// A mocked fetch only: no call reaches Apollo.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApolloClient } from "@/lib/adapters/live/apollo";
import { resetBreakers } from "@/lib/adapters/live/http";

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];
const respond = (...answers: Response[]) => {
  calls = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return answers.shift() ?? new Response("{}", { status: 200 }); }) as typeof fetch;
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
beforeEach(() => resetBreakers());
afterEach(() => { globalThis.fetch = realFetch; });

describe("Apollo calls are retried the way every other service's are", () => {
  it("a rate limit (429, Retry-After) and a server error are retried, then the answer is used", async () => {
    respond(new Response("slow down", { status: 429, headers: { "retry-after": "0" } }), new Response("oops", { status: 503 }), json({ labels: [] }));
    expect(await new ApolloClient("key", [0, 0]).get("/labels")).toEqual({ labels: [] });
    expect(calls).toHaveLength(3);
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("key");
  });
  it("a refused key or plan (403) is not retried, and says what it means", async () => {
    respond(new Response("forbidden", { status: 403 }));
    await expect(new ApolloClient("key", [0, 0]).post("/mixed_people/search", {})).rejects.toThrow(/403 \(this API key or plan can't use this endpoint\): forbidden/);
    expect(calls).toHaveLength(1);
  });
  it("still rate limited after the retries: a clear message", async () => {
    respond(new Response("a", { status: 429 }), new Response("b", { status: 429 }), new Response("c", { status: 429 }));
    await expect(new ApolloClient("key", [0, 0]).get("/labels")).rejects.toThrow(/429 \(rate limit — try later\)/);
    expect(calls).toHaveLength(3);
  });
});

describe("Apollo's website-visitor list is read through every page, and a longer list is said", () => {
  const page = (n: number, total: number) => json({ accounts: Array.from({ length: 100 }, (_, i) => ({ name: `Co ${n}-${i}`, domain: `co${n}-${i}.example` })), pagination: { total_pages: total } });
  it("reads all pages, and marks the result when there are more pages than allowed", async () => {
    const { apolloVisitorCompanies } = await import("@/lib/adapters/live/apollo");
    respond(page(1, 3), page(2, 3), page(3, 3));
    const all = await apolloVisitorCompanies("key", { id: "L1" }, 20, [0, 0]);
    expect(all).toHaveLength(300);
    expect(all.truncated).toBe(false);
    respond(page(1, 4), page(2, 4));
    const cut = await apolloVisitorCompanies("key", { id: "L1" }, 2, [0, 0]);
    expect(cut).toHaveLength(200);
    expect(cut.truncated).toBe(true);
    expect(cut.totalPages).toBe(4);
  });
});
