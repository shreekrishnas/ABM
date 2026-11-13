// The main desktop journeys, clicked through in a real browser against the app running on
// stand-in services and sample data. Any page error or failed page load fails the test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright comes with the machine's browser install (not a project dependency), so it's loaded at run time.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;
type Browser = any;
type BrowserContext = any;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as { chromium: any };
const PORT = Number(process.env.E2E_PORT ?? 3200);
const BASE = `http://localhost:${PORT}`;
const session = JSON.parse(readFileSync(new URL("./.session.json", import.meta.url), "utf8")) as { token: string; client: string };

let server: ChildProcess;
let browser: Browser;
let ctx: BrowserContext;
const errors: string[] = [];

async function open(path: string): Promise<Page> {
  const p = await ctx.newPage();
  p.on("pageerror", (e: Error) => errors.push(`${path}: ${e.message}`));
  const res = await p.goto(BASE + path, { waitUntil: "networkidle" });
  expect(res?.status(), `${path} loads`).toBeLessThan(400);
  return p;
}

beforeAll(async () => {
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, NODE_ENV: "production", VITEST: undefined, DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://abm:abm@localhost:5432/abm_e2e?schema=public", ADAPTER_MODE: "mock", AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/login`)).status < 500) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([
    { name: "abm_session", value: session.token, url: BASE },
    { name: "abm_mode", value: "super", url: BASE },
    { name: "abm_client", value: session.client, url: BASE },
  ]);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
  expect(errors, "no page errors").toEqual([]);
});

describe("1. Understand a company", () => {
  it("Companies list → company page → research card with sources and confidence", async () => {
    const p = await open("/accounts");
    const first = p.locator(".dir-table tbody a.dir-co").first();
    await expect(first.count()).resolves.toBeGreaterThan(0);
    await first.click();
    await p.waitForURL(/\/accounts\/[^/?]+$/);
    const card = p.locator("section:has(h2:text('What we know'))");
    await expect(card.count()).resolves.toBe(1);
    expect(await card.locator(".rs-conf").count()).toBeGreaterThan(0);
    await p.close();
  });
});

describe("2. Find companies", () => {
  it("Market signals shows Recommended today and its controls", async () => {
    const p = await open("/discover");
    await expect(p.locator("#recommended").count()).resolves.toBe(1);
    await p.close();
  });
  it("Lookalikes, Describe companies and Website visitors open", async () => {
    for (const path of ["/import", "/import/lookalikes", "/import/describe", "/import/apollo"]) (await open(path)).close();
  });
});

describe("3. Long tasks don't hold up the app", () => {
  it("Run pipeline answers at once and another section opens straight away", async () => {
    const p = await open("/accounts");
    await p.locator(".dir-table tbody a.dir-co").first().click();
    await p.waitForURL(/\/accounts\/[^/?]+$/);
    const t = Date.now();
    await p.getByRole("button", { name: /Run pipeline/ }).click();
    await p.waitForSelector("text=/Started:|Already running|Live research is off/", { timeout: 10_000 });
    expect(Date.now() - t).toBeLessThan(5_000);
    const t2 = Date.now();
    await p.goto(`${BASE}/discover`, { waitUntil: "domcontentloaded" });
    expect(Date.now() - t2).toBeLessThan(5_000);
    await p.close();
  });
});

describe("5. Approving an email", () => {
  it("Approvals shows why the email says what it says", async () => {
    const p = await open("/review");
    expect(await p.locator(".wte").count()).toBeGreaterThan(0);
    expect(await p.locator(".wte").first().innerText()).toMatch(/Why now/);
    await p.close();
  });
});

describe("4. Daily work", () => {
  it("Home, Today, Approvals and Insights open", async () => {
    for (const path of ["/", "/work/today", "/review", "/pipeline", "/analytics"]) (await open(path)).close();
  });
});
