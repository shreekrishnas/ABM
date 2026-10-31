import { afterEach, describe, expect, it, vi } from "vitest";
import { ZeroBounceVerifier } from "@/lib/adapters/live/email";
import { resetBreakers } from "@/lib/adapters/live/http";

const mx = (ok: boolean) => ({ verify: async () => ({ deliverable: ok, reason: ok ? "domain accepts email" : "no mail server", status: ok ? ("probable" as const) : ("invalid" as const) }) });
const reply = (body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

afterEach(() => {
  vi.unstubAllGlobals();
  resetBreakers();
});

describe("mailbox verification (ZeroBounce)", () => {
  it("confirms a real mailbox, flags catch-all, rejects invalid ones", async () => {
    vi.stubGlobal("fetch", reply({ status: "valid" }));
    expect(await new ZeroBounceVerifier("k", mx(true)).verify("a@acme.com")).toMatchObject({ deliverable: true, status: "verified" });
    vi.stubGlobal("fetch", reply({ status: "catch-all" }));
    expect(await new ZeroBounceVerifier("k", mx(true)).verify("a@acme.com")).toMatchObject({ deliverable: true, status: "probable", reason: expect.stringMatching(/catch-all/) });
    vi.stubGlobal("fetch", reply({ status: "invalid", sub_status: "mailbox_not_found" }));
    expect(await new ZeroBounceVerifier("k", mx(true)).verify("a@acme.com")).toMatchObject({ deliverable: false, status: "invalid", reason: expect.stringMatching(/mailbox not found/) });
  });

  it("skips the paid call when the domain has no mail server", async () => {
    const f = reply({ status: "valid" });
    vi.stubGlobal("fetch", f);
    expect(await new ZeroBounceVerifier("k", mx(false)).verify("a@nowhere.test")).toMatchObject({ deliverable: false, status: "invalid" });
    expect(f).not.toHaveBeenCalled();
  });

  it("falls back to the free check when the service is down, and never puts the key in the reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    const r = await new ZeroBounceVerifier("secret-key-123", mx(true)).verify("a@acme.com");
    expect(r).toMatchObject({ deliverable: true, status: "probable" });
    expect(r.reason).not.toContain("secret-key-123");
  });
});
