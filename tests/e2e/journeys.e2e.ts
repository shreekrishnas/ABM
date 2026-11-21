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
    await p.waitForSelector(".peek-drawer");
    await p.locator("[data-peek-open]").click();
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
    await p.waitForSelector(".peek-drawer");
    await p.locator("[data-peek-open]").click();
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

describe("5b. Approvals renders every kind of item", () => {
  const types = ["draft_approval", "proposed_rejection", "identity_conflict", "contradiction", "needs_human_reply", "no_usable_person"];
  it("opens each item type without an error, with no 'couldn't load' card", async () => {
    for (const t of types) {
      const p = await open(`/review?type=${t}`);
      expect(await p.getByText("This page couldn't load").count(), `${t} renders`).toBe(0);
      await p.close();
    }
  });

  it("an open email draft shows labelled fields, a live word count, and working Approve / Reject buttons", async () => {
    const p = await open("/review?type=draft_approval");
    const form = p.locator("form.dz-form").first();
    await expect(form.count()).resolves.toBe(1);
    for (const [label, name] of [["Subject", "subject"], ["Body", "body"], ["Note", "note"]] as const) {
      const field = form.locator(`[name="${name}"]`);
      const id = await field.getAttribute("id");
      expect(id, `${name} has an id`).toBeTruthy();
      expect(await form.locator(`label[for="${id}"]`).innerText(), `${name} label`).toContain(label);
    }
    // Editing the body updates the word count (the editor is interactive, not just rendered).
    const words = form.locator(".dz-words");
    const before = await words.innerText();
    const body = form.locator('[name="body"]');
    // The count stops at the unsubscribe/footer lines, so add words at the top.
    await body.fill(`One two three four five six seven eight nine ten.\n\n${await body.inputValue()}`);
    await expect.poll(() => words.innerText()).not.toBe(before);
    for (const v of ["approve", "reject"]) {
      const b = form.locator(`button[name="decision"][value="${v}"]`);
      await expect(b.count()).resolves.toBe(1);
      expect(await b.isEnabled(), `${v} enabled`).toBe(true);
    }
    await p.close();
  });

  it("Companies filters still filter, and Add company keeps its labelled fields", async () => {
    const p = await open("/accounts");
    // The filter panel on the page (FilterPanel, not FormField): choosing a value changes the address.
    const filter = p.locator("select:visible").first();
    const before = p.url();
    const value = await filter.locator("option").nth(1).getAttribute("value");
    expect(value, "a filter option to pick").toBeTruthy();
    await filter.selectOption(value!);
    await expect.poll(() => p.url(), { timeout: 10_000 }).not.toBe(before);
    // Add company is the client-side FormField user: each label must point at its input.
    await p.goto(BASE + "/accounts", { waitUntil: "networkidle" });
    await p.locator("button", { hasText: "Add company" }).first().click();
    const name = p.locator('input[name="name"]').first();
    await name.waitFor();
    const nid = await name.getAttribute("id");
    expect(nid, "company name has an id").toBeTruthy();
    expect(await p.locator(`label[for="${nid}"]`).innerText()).toContain("Company name");
    await p.close();
  });
});

describe("5c. One count for what's waiting", () => {
  it("the Engage badge, Home, Today and Approvals show the same total, and every Approvals tile opens a list of that size", async () => {
    const num = (t: string) => Number((t.match(/\d+/) ?? ["NaN"])[0]);
    const home = await open("/");
    const badge = num(await home.locator('nav[aria-label="Main"] a:has-text("Engage")').first().innerText());
    const homeCard = num(await home.locator(".ws-metric.m0 .ws-metric-v").innerText());
    await home.close();
    const today = await open("/work/today");
    const todayTab = num(await today.locator(".td3-tabs a").first().innerText());
    await today.close();
    const review = await open("/review");
    const all = num(await review.locator(".dz-chip.on").first().innerText());
    const tiles: { href: string; n: number }[] = await review.evaluate(() => [...document.querySelectorAll("a")].filter((a) => /^(Right person\?|Rule out a company\?|Emails to approve|Everything else)/.test(a.textContent ?? "")).map((a) => ({ href: a.getAttribute("href")!, n: Number((a.textContent!.match(/\?(\d+)|approve(\d+)|else(\d+)/) ?? []).slice(1).find(Boolean)) })));
    await review.close();
    expect(badge).toBeGreaterThan(0);
    expect([homeCard, todayTab, all]).toEqual([badge, badge, badge]);
    expect(tiles).toHaveLength(4);
    expect((tiles as { n: number }[]).reduce((t, x) => t + x.n, 0)).toBe(badge);
    for (const t of tiles) {
      if (!t.n) continue;
      const p = await open(t.href);
      expect(await p.locator(".dz-item").count(), `${t.href} lists what its tile counts`).toBe(Math.min(t.n, 50));
      await p.close();
    }
  });
});

describe("4. Daily work", () => {
  it("Home, Today, Approvals and Insights open", async () => {
    for (const path of ["/", "/work/today", "/review", "/pipeline", "/analytics"]) (await open(path)).close();
  });

  it("Home previews a company and a decision in a side panel, and a funnel bar opens its companies", async () => {
    const p = await open("/");
    await p.locator(".ws-table tbody tr").first().locator("td").nth(1).click();
    await p.waitForSelector(".peek-drawer");
    expect(p.url()).toMatch(/peek=a_/);
    await p.keyboard.press("Escape");
    await p.waitForURL((u: URL) => !u.search.includes("peek="));
    await p.locator(".ws-qrow a").first().click();
    await p.waitForSelector(".peek-drawer");
    expect(await p.locator("[data-peek-open]").innerText()).toMatch(/Open in Approvals/);
    await p.goto(BASE + "/accounts?flow=qualified", { waitUntil: "networkidle" });
    expect(await p.locator(".dir-chips").innerText()).toMatch(/Reached: Qualified/);
    await p.close();
  });
});

describe("8. Vega", () => {
  it("opens for a Super Admin with the briefing, chat and company focus, and settles", async () => {
    const p = await open("/vega");
    const text = await p.locator("body").innerText();
    expect(text).toMatch(/Ask Vega/);
    expect(text).toMatch(/waiting for you/);
    expect(await p.locator(".jv-ctx").count()).toBe(1);
    await p.close();
  });
});
