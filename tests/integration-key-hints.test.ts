// Integrations: a saved secret never reaches the browser, not even its last characters.
import { describe, expect, it } from "vitest";

describe("integration key hints", () => {
  it("shows that a secret is saved without any of its characters; plain settings stay readable", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-secret-9876";
    process.env.APOLLO_VISITOR_LIST = "Website Visitors";
    const { integrationKeyStates } = await import("@/lib/integration-keys");
    const states = await integrationKeyStates();
    const all = [...states.values()].flatMap((s) => s.fields);
    const key = all.find((f) => f.env === "OPENROUTER_API_KEY")!;
    expect(key.hint).toBe("••••••••");
    expect(JSON.stringify(all)).not.toMatch(/9876|sk-or-test/);
    expect(all.find((f) => f.env === "APOLLO_VISITOR_LIST")?.hint).toBe("Website Visitors");
  });
});
