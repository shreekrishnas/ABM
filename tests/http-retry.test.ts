import { afterEach, describe, expect, it, vi } from "vitest";
import { BREAKER_AFTER, fetchJson, resetBreakers } from "@/lib/adapters/live/http";

const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  resetBreakers();
});

describe("calls to outside services", () => {
  it("retries 429 and 5xx with waits, then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200, { ok: 1 }));
    vi.stubGlobal("fetch", f);
    expect(await fetchJson("Svc", "https://x.test", { waits: [1, 1] })).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400", async () => {
    const f = vi.fn().mockResolvedValue(res(400, { error: "bad" }));
    vi.stubGlobal("fetch", f);
    await expect(fetchJson("Svc", "https://x.test", { waits: [1, 1] })).rejects.toThrow(/Svc 400/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("pauses a service after repeated failures, so runs move on instead of waiting", async () => {
    const f = vi.fn().mockResolvedValue(res(500));
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < BREAKER_AFTER; i++) await expect(fetchJson("Down", "https://x.test", { waits: [] })).rejects.toThrow(/Down 500/);
    const before = f.mock.calls.length;
    await expect(fetchJson("Down", "https://x.test", { waits: [] })).rejects.toThrow(/paused after repeated failures/);
    expect(f.mock.calls.length).toBe(before); // not called while paused
    // Other services are unaffected.
    f.mockResolvedValueOnce(res(200, { ok: 2 }));
    expect(await fetchJson("Up", "https://x.test", { waits: [] })).toEqual({ ok: 2 });
  });
});
