import { describe, expect, it } from "vitest";
import { codeHash, domainAllowed, normalizeEmail, sessionToken, sign, verify, type Session } from "@/lib/auth";

describe("sign-in", () => {
  it("only lets the allowed domain in", () => {
    process.env.AUTH_EMAIL_DOMAINS = "trilliantdigital.com";
    expect(domainAllowed("shree@trilliantdigital.com")).toBe(true);
    expect(domainAllowed("shree@gmail.com")).toBe(false);
    expect(domainAllowed("x@evil-trilliantdigital.com")).toBe(false);
    expect(domainAllowed("x@trilliantdigital.com.evil.io")).toBe(false);
    expect(normalizeEmail("  Shree@TrilliantDigital.com ")).toBe("shree@trilliantdigital.com");
    expect(normalizeEmail("not an email")).toBeNull();
  });

  it("signs sessions that can't be forged or reused after expiry", async () => {
    const t = await sessionToken("a@trilliantdigital.com", "s1");
    expect((await verify<Session>(t, "s1"))?.email).toBe("a@trilliantdigital.com");
    expect(await verify<Session>(t, "other")).toBeNull();
    const [body, sig] = t.split(".");
    const forged = btoa(JSON.stringify({ email: "b@trilliantdigital.com", exp: Date.now() + 1e6 })).replace(/=+$/, "");
    expect(await verify<Session>(`${forged}.${sig}`, "s1")).toBeNull();
    expect(await verify<Session>(`${body}x.${sig}`, "s1")).toBeNull();
    expect(await verify(await sign({ email: "a", exp: Date.now() - 1 }, "s1"), "s1")).toBeNull();
  });

  it("ties a code to one email", async () => {
    expect(await codeHash("123456", "a@x.com", "s")).toBe(await codeHash("123456", "a@x.com", "s"));
    expect(await codeHash("123456", "a@x.com", "s")).not.toBe(await codeHash("123456", "b@x.com", "s"));
  });
});
