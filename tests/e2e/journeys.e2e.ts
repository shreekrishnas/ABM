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
const session = JSON.parse(readFileSync(new URL("./.session.json", import.meta.url), "utf8")) as { token: string; client: string; roles: Record<"rep" | "viewer" | "limited", string> };

let server: ChildProcess;
let browser: Browser;
let ctx: BrowserContext;
const errors: string[] = [];

async function open(path: string, before?: (p: Page) => void): Promise<Page> {
  const p = await ctx.newPage();
  p.on("pageerror", (e: Error) => errors.push(`${path}: ${e.message}`));
  before?.(p);
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

// Runs last: these journeys make real decisions on the seeded items.
describe("9. One Approvals workspace for every decision", () => {
  const pick = (p: Page) => new URL(p.url()).searchParams.get("pick");
  const decidedCount = async () => {
    const p = await open("/review?status=decided");
    const n = Number((await p.locator('nav[aria-label="Status"] a', { hasText: "Recently decided" }).innerText()).match(/\d+/)?.[0]);
    await p.close();
    return n;
  };
  const waitingIds = async (path: string) => {
    const p = await open(path);
    const ids = await p.locator(".dz-item").evaluateAll((as: Element[]) => as.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get("pick")));
    await p.close();
    return ids;
  };

  it("Home → Approvals: a Home item opens that exact item, and the decision is recorded", async () => {
    const before = await decidedCount();
    const p = await open("/");
    const link = p.locator('a[href*="/review?type="][href*="pick="]').first();
    const target = new URL(BASE + (await link.getAttribute("href"))).searchParams.get("pick");
    await link.click();
    await p.waitForURL(/\/review\?/);
    expect(pick(p)).toBe(target);
    expect(await p.locator(".dz-item.on").getAttribute("href")).toContain(`pick=${target}`);
    await p.locator(".dz-actions button").first().click(); // the item's main decision
    await p.waitForTimeout(9500); // one-click decisions wait 8 s behind Undo before they run
    await p.close();
    expect(await decidedCount()).toBe(before + 1);
    expect(await waitingIds("/review")).not.toContain(target);
  }, 60_000);

  it("Today → Approvals: an email from Today opens in Approvals, is rejected, and the next one opens", async () => {
    const before = await decidedCount();
    const p = await open("/work/today?q=approvals");
    const row = p.locator('a[href*="type=draft_approval&pick="]').first();
    const target = new URL(BASE + (await row.getAttribute("href"))).searchParams.get("pick");
    await row.click();
    await p.waitForURL(/\/review\?/);
    expect(pick(p)).toBe(target);
    await p.locator('form.dz-form button[name="decision"][value="reject"]').click();
    await expect.poll(() => pick(p), { timeout: 15_000 }).not.toBe(target);
    await p.close();
    expect(await decidedCount()).toBe(before + 1);
    expect(await waitingIds("/review?type=draft_approval")).not.toContain(target);
  }, 60_000);

  it("Vega → Approvals: Vega's recommendation links to the email, which is approved in Approvals", async () => {
    const p = await open("/vega");
    expect(await p.getByRole("button", { name: /Approve .* selected/ }).count(), "no separate approve button in Vega").toBe(0);
    const link = p.locator("a.jv-rec-open").first();
    const target = new URL(BASE + (await link.getAttribute("href"))).searchParams.get("pick");
    await link.click();
    await p.waitForURL(/\/review\?/);
    expect(pick(p)).toBe(target);
    await p.locator('form.dz-form button[name="decision"][value="approve"]').click();
    await expect.poll(() => pick(p), { timeout: 15_000 }).not.toBe(target);
    await p.close();
    expect(await waitingIds("/review?type=draft_approval")).not.toContain(target);
  }, 60_000);

  it("Edit a draft → approve: the edited email is approved and shows as decided", async () => {
    const p = await open("/review?type=draft_approval");
    const target = pick(p) ?? new URL((await p.locator(".dz-item.on").evaluate((a: Element) => (a as HTMLAnchorElement).href))).searchParams.get("pick");
    const form = p.locator("form.dz-form").first();
    await form.locator('[name="subject"]').fill("Edited in the approvals journey");
    await form.locator('[name="note"]').fill("tightened the subject");
    await form.locator('button[name="decision"][value="approve"]').click();
    await expect.poll(async () => (await waitingIds("/review?type=draft_approval")).includes(target), { timeout: 15_000 }).toBe(false);
    await p.close();
    const d = await open(`/review?status=decided&type=draft_approval&pick=${target}`);
    expect(await d.locator(".dz-pane").innerText()).toMatch(/Resolved|Dismissed/);
    expect(await d.locator(".dz-pane button").count(), "decided items are read-only").toBe(0);
    await d.close();
  }, 60_000);

  it("Resolve an item → the next pending item opens straight away", async () => {
    const ids = await waitingIds("/review?type=contradiction");
    expect(ids.length).toBeGreaterThan(1);
    const p = await open(`/review?type=contradiction&pick=${ids[0]}`);
    await p.locator(".dz-actions button", { hasText: "Resolve" }).click();
    await expect.poll(() => pick(p), { timeout: 5_000 }).toBe(ids[1]);
    await p.waitForTimeout(9500);
    await p.close();
    expect(await waitingIds("/review?type=contradiction")).not.toContain(ids[0]);
  }, 60_000);

  it("filters by Checks and Sign-offs, with counts that match the shared totals", async () => {
    const p = await open("/review?kind=approval");
    const seg = await p.locator('nav[aria-label="Show"] a').allInnerTexts();
    const n = (s: string) => Number(s.match(/\d+/)?.[0]);
    expect(n(seg[0])).toBe(n(seg[1]) + n(seg[2]));
    expect(await p.locator(".dz-item").count()).toBe(Math.min(n(seg[2]), 50));
    await p.close();
  });
});

describe("10. One Vega everywhere", () => {
  it("the old robot button is gone; the Vega button is on other pages and Home keeps its core", async () => {
    const accounts = await open("/accounts");
    expect(await accounts.locator(".assistant-fab").count()).toBe(0);
    expect(await accounts.locator(".vg-fab").count()).toBe(1);
    await accounts.close();
    const home = await open("/");
    expect(await home.locator(".vg-fab").count(), "Home uses its core instead").toBe(0);
    await home.locator("button.jo").click();
    await home.waitForSelector(".jo-panel");
    expect(await home.locator(".jo-panel .jo-hist").count()).toBe(1);
    expect(await home.locator(".jo-panel").innerText()).toMatch(/Ask Vega/);
    await home.keyboard.press("Escape");
    await home.close();
  });

  it("on a company page, Ctrl+J opens Vega focused on that company, with a link to the full workspace", async () => {
    const list = await open("/accounts");
    const link = list.locator(".dir-table tbody a.dir-co").first();
    const peek = new URL(BASE + (await link.getAttribute("href"))).searchParams.get("peek")!; // a_<id>
    const name = (await link.locator("b, strong").first().innerText().catch(async () => (await link.innerText()).split("\n")[0])).trim();
    await list.close();
    const id = peek.slice(2);
    const p = await open(`/accounts/${id}`);
    await p.keyboard.press("Control+j");
    await p.waitForSelector(".jo-panel");
    await expect.poll(() => p.locator(".jo-focus").innerText().catch(() => ""), { timeout: 10_000 }).toContain(name);
    expect(await p.locator(".jo-full").getAttribute("href")).toContain(`a=${id}`);
    await p.close();
    // A company previewed in the side panel of the list counts too.
    const prev = await open(`/accounts?peek=${peek}`);
    await prev.locator(".vg-fab").click();
    await expect.poll(() => prev.locator(".jo-focus").innerText().catch(() => ""), { timeout: 10_000 }).toContain(name);
    await prev.close();
  });

  it('"This week" answers from the records inside the panel, without leaving the page', async () => {
    const p = await open("/analytics");
    const before = p.url();
    await p.locator(".vg-fab").click();
    await p.waitForSelector(".jo-panel");
    await p.locator(".jo-panel .jv-week").click();
    await expect.poll(() => p.locator(".jo-panel .jv-a-title").first().innerText().catch(() => ""), { timeout: 20_000 }).toMatch(/^This week/);
    expect(p.url()).toBe(before);
    await p.locator(".jo-panel .jo-hist").click();
    expect(await p.locator(".jo-history").innerText()).toMatch(/New conversation/);
    await p.close();
  });
});

describe("11. Navigation", () => {
  // Every module page: the browser title, heading, trail, sub-tab and rail all name the same page.
  const PAGES: { href: string; label: string; section: string; title?: string; h1?: RegExp | null }[] = [
    { href: "/accounts", label: "Companies", section: "Accounts" },
    { href: "/people", label: "People", section: "Accounts" },
    { href: "/accounts/coverage", label: "Coverage", section: "Accounts", title: "Buying-group coverage", h1: /^Buying-group coverage$/ },
    { href: "/signals", label: "Signals", section: "Accounts" },
    { href: "/import", label: "All ways in", section: "Prospecting", h1: null },
    { href: "/import/upload", label: "Upload CSV", section: "Prospecting", h1: null },
    { href: "/import/describe", label: "Describe companies", section: "Prospecting", h1: null },
    { href: "/import/lookalikes", label: "Lookalikes", section: "Prospecting", h1: null },
    { href: "/import/apollo", label: "Website visitors", section: "Prospecting", h1: null },
    { href: "/discover", label: "Market signals", section: "Prospecting" },
    { href: "/work/today", label: "Today", section: "Engage", h1: /^Today/ },
    { href: "/review", label: "Approvals", section: "Engage" },
    { href: "/outreach", label: "Emails", section: "Engage" },
    { href: "/handoffs", label: "Hand-offs", section: "Pipeline" },
    { href: "/crm/opportunities", label: "Deals", section: "Pipeline" },
    { href: "/crm/tasks", label: "Tasks", section: "Pipeline" },
    { href: "/overview", label: "Program overview", section: "Insights" },
    { href: "/analytics", label: "What's working", section: "Insights" },
    { href: "/pipeline", label: "Behind the scenes", section: "Insights" },
    { href: "/admin", label: "Overview", section: "Admin", title: "Admin overview" },
    { href: "/admin/integrations", label: "Integrations", section: "Admin" },
    { href: "/brain", label: "Account Brain", section: "Admin" },
    { href: "/settings", label: "Settings", section: "Admin" },
    { href: "/team", label: "Team & Access", section: "Admin" },
  ];
  const FIRST = new Set(["/accounts", "/import", "/work/today", "/handoffs", "/overview", "/admin"]);
  const consoleErrors: string[] = [];
  const watch = (p: Page, where: string) => p.on("console", (m: any) => m.type() === "error" && !/status of 404/.test(m.text()) && consoleErrors.push(`${where}: ${m.text().slice(0, 160)}`));
  const tabs = async (p: Page) => (await p.locator(".nav-sub .nav-page").allInnerTexts()).map((t: string) => t.replace(/\d+$/, "").trim());
  async function as(role: "rep" | "viewer" | "limited" | "full") {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await c.addCookies([
      { name: "abm_session", value: role === "full" ? session.token : session.roles[role], url: BASE },
      { name: "abm_mode", value: "super", url: BASE }, // asked for by everyone; only Super Admins get it
      { name: "abm_client", value: session.client, url: BASE },
    ]);
    return c;
  }

  it("every module page: title, heading, trail, active tab and rail agree", async () => {
    for (const pg of PAGES) {
      const p = await open(pg.href, (x) => watch(x, pg.href));
      expect(await p.title(), pg.href).toBe(`${pg.title ?? pg.label} · ABM Intelligence`);
      if (pg.h1 !== null) expect((await p.locator("main h1").first().textContent())?.trim(), pg.href).toMatch(pg.h1 ?? new RegExp(`^${pg.label}$`));
      expect((await p.locator('.nav-crumbs [aria-current="page"]').textContent())?.trim(), pg.href).toBe(FIRST.has(pg.href) ? pg.section : pg.label);
      expect((await p.locator(".nav-sub .nav-page.on").innerText()).replace(/\d+$/, "").trim(), pg.href).toBe(pg.label);
      expect(await p.locator(`.sh-rail .sh-item.on[aria-label="${pg.section}"]`).count(), pg.href).toBe(1);
      await p.close();
    }
    const home = await open("/");
    expect(await home.title()).toBe("Home · ABM Intelligence");
    await home.close();
  }, 180_000);

  it("old addresses still redirect, and a company page names the company and links back up", async () => {
    for (const [from, to] of [["/companies", "/accounts"], ["/crm", "/people"], ["/crm/contacts", "/people"], ["/work", "/work/today"], ["/jarvis", "/vega"]]) {
      const p = await open(from);
      expect(new URL(p.url()).pathname, from).toBe(to);
      await p.close();
    }
    const list = await open("/accounts");
    const id = (await list.locator(".dir-table tbody a.dir-co").first().getAttribute("href"))!.match(/a_([^&]+)/)![1];
    await list.close();
    const p = await open(`/accounts/${id}`, (x) => watch(x, "company"));
    const name = (await p.locator("main h1").first().textContent())!.trim();
    expect(await p.title()).toBe(`${name} · ABM Intelligence`);
    expect(await p.locator('.nav-crumbs [aria-current="page"]').count()).toBe(0);
    await p.locator('.nav-crumbs a[href="/accounts"]').click();
    await p.waitForURL(/\/accounts$/);
    await p.close();
  });

  it("works from the keyboard: skip link, tabs, and the command palette", async () => {
    const p = await open("/crm/opportunities", (x) => watch(x, "keyboard"));
    await p.keyboard.press("Tab");
    expect(await p.evaluate(() => document.activeElement?.textContent)).toBe("Skip to content");
    await p.locator('.nav-sub a[href="/crm/tasks"]').focus();
    await p.keyboard.press("Enter");
    await p.waitForURL(/\/crm\/tasks$/);
    expect(await p.locator('.nav-sub a[href="/crm/tasks"]').getAttribute("aria-current")).toBe("page");
    await p.keyboard.press("Control+k");
    await p.locator(".palette-list").waitFor();
    await p.keyboard.type("What's working");
    await p.locator('.palette-list [role="option"]', { hasText: "What's working" }).first().waitFor();
    await p.keyboard.press("Enter");
    await p.waitForURL(/\/analytics$/);
    await p.close();
  });

  it("shows each role only what it can open: Rep, Viewer, limited and full Super Admin", async () => {
    const want = { rep: false, viewer: false, limited: true, full: true } as const;
    for (const role of ["rep", "viewer", "limited", "full"] as const) {
      const c = await as(role);
      const p = await c.newPage();
      p.on("pageerror", (e: Error) => errors.push(`${role}: ${e.message}`));
      watch(p, role);
      await p.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
      expect((await tabs(p)).includes("Team & Access"), role).toBe(want[role]);
      // Today → Approvals is open to everyone.
      await p.goto(`${BASE}/work/today`, { waitUntil: "networkidle" });
      await p.locator('.nav-sub a[href="/review"]').click();
      await p.waitForURL(/\/review/);
      expect((await p.locator("main h1").first().textContent())?.trim(), role).toBe("Approvals");
      // Vega stays with Super Admins covering the client.
      expect(await p.locator(".vg-fab").count(), role).toBe(want[role] ? 1 : 0);
      // The palette offers Team & Access to Super Admins only.
      await p.keyboard.press("Control+k");
      await p.locator(".palette-list").waitFor();
      await p.keyboard.type("Team & Access");
      await p.waitForTimeout(400);
      expect(await p.locator('.palette-list [role="option"]', { hasText: "Team & Access" }).count(), role).toBe(want[role] ? 1 : 0);
      await p.keyboard.press("Escape");
      await p.waitForLoadState("networkidle");
      // The page itself still decides: no Super Admin, no Team & Access.
      await p.goto(`${BASE}/team`, { waitUntil: "networkidle" });
      if (want[role]) {
        expect((await p.locator("main h1").first().textContent())?.trim(), role).toBe("Team & Access");
        const sections = await p.locator(".tm-tabs").innerText();
        expect(sections, role).toMatch(/Clients/);
        expect(/System health/.test(sections), role).toBe(role === "full");
      } else {
        // Not found (streamed, so the status line is already sent): nothing of the page shows.
        expect(await p.locator("main").innerText(), role).toMatch(/Page not found/);
        expect(await p.locator(".tm-tabs").count(), role).toBe(0);
      }
      await c.close();
    }
  }, 120_000);

  it("switching client changes the workspace and shows only that client's companies", async () => {
    const c = await as("full");
    const p = await c.newPage();
    p.on("pageerror", (e: Error) => errors.push(`clients: ${e.message}`));
    watch(p, "clients");
    await p.goto(`${BASE}/clients`, { waitUntil: "networkidle" });
    expect(await p.title()).toBe("Clients · ABM Intelligence");
    expect((await p.locator("main h1").textContent())?.trim()).toBe("Clients");
    await p.locator("li.ac-card", { hasText: "Second client" }).getByRole("button", { name: /Open client/ }).click();
    await p.waitForURL(`${BASE}/`);
    await p.goto(`${BASE}/accounts`, { waitUntil: "networkidle" });
    expect(await p.locator(".nav-crumbs").innerText()).toMatch(/Clients[\s\S]*Second client[\s\S]*Accounts/);
    expect(await p.locator(".dir-table tbody a.dir-co").count()).toBe(0);
    await p.goto(`${BASE}/clients`, { waitUntil: "networkidle" });
    await p.locator("li.ac-card", { hasText: "Sample client" }).getByRole("button", { name: /Open client/ }).click();
    await p.waitForURL(`${BASE}/`);
    await p.goto(`${BASE}/accounts`, { waitUntil: "networkidle" });
    expect(await p.locator(".dir-table tbody a.dir-co").count()).toBeGreaterThan(0);
    await c.close();
    expect(consoleErrors, "no console errors").toEqual([]);
  }, 60_000);
});
