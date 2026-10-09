import { afterEach, describe, expect, it } from "vitest";
import { authorize, securityStatus } from "@/lib/api";

const env = process.env as Record<string, string | undefined>;
const saved = { ...env };
afterEach(() => {
  for (const k of ["NODE_ENV", "ABM_API_KEY", "CRON_SECRET", "ABM_API_OPEN"]) env[k] = saved[k];
});

const req = (token?: string) => new Request("http://x/api/v1/tick", { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("API access", () => {
  it("is open in development when no key is set", () => {
    env.NODE_ENV = "development";
    delete env.ABM_API_KEY;
    expect(authorize(req())).toBeNull();
  });

  it("fails closed in production when no key is set", () => {
    env.NODE_ENV = "production";
    delete env.ABM_API_KEY;
    delete env.ABM_API_OPEN;
    expect(authorize(req())?.status).toBe(503);
    expect(authorize(req(), { alsoAccept: [undefined] })?.status).toBe(503);
  });

  it("ABM_API_OPEN=true is an explicit opt-out in production", () => {
    env.NODE_ENV = "production";
    delete env.ABM_API_KEY;
    env.ABM_API_OPEN = "true";
    expect(authorize(req())).toBeNull();
    expect(securityStatus().apiOpen).toBe(true);
  });

  it("accepts the API key and rejects anything else", () => {
    env.NODE_ENV = "production";
    env.ABM_API_KEY = "k-123";
    expect(authorize(req("k-123"))).toBeNull();
    expect(authorize(req("k-124"))?.status).toBe(401);
    expect(authorize(req())?.status).toBe(401);
  });

  it("the scheduler secret works on its own, without an API key", () => {
    env.NODE_ENV = "production";
    delete env.ABM_API_KEY;
    expect(authorize(req("cron-s"), { alsoAccept: ["cron-s"] })).toBeNull();
    expect(authorize(req("wrong"), { alsoAccept: ["cron-s"] })?.status).toBe(401);
  });
});
