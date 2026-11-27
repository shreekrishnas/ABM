// Navigation by role: what the module tabs, the top-bar trail and the command palette list for a
// Rep, a Viewer, a Super Admin covering some clients and one covering every client. Navigation only
// decides what is offered; every page and action still checks access on the server.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path, useRouter: () => ({ push: () => undefined, refresh: () => undefined }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/shell/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/shell/JobsIndicator", () => ({ JobsIndicator: () => null }));
vi.mock("@/components/shell/SuperAdminSwitch", () => ({ SuperAdminSwitch: () => null }));
vi.mock("@/app/actions", () => ({ assignToMeAction: vi.fn(), manualHandoffAction: vi.fn(), runAccountAction: vi.fn() }));

import { SECTIONS, shown, locate, type NavViewer } from "@/lib/nav";
import { AppNav } from "@/components/shell/AppNav";
import { palettePages } from "@/components/shell/CommandPalette";

// How the layout describes each person to the navigation (me.canSuperAdmin, me.superAdmin).
const ROLES: Record<string, NavViewer | undefined> = {
  rep: { can: false, on: false },
  viewer: { can: false, on: false },
  "limited Super Admin": { can: true, on: true },
  "full Super Admin": { can: true, on: true },
};
const admin = SECTIONS.find((s) => s.key === "admin")!;
const labels = (items: { label: string }[]) => items.map((p) => p.label);
const counts = { review: 0, handoffs: 0, tasks: 0 };
const tabsOn = (at: string, viewer: NavViewer | undefined, extras = true) => {
  path = at;
  const html = renderToStaticMarkup(<AppNav counts={counts} discover={0} sellerName="Client A" extras={extras} superAdmin={viewer} />);
  return [...html.matchAll(/class="nav-page[^"]*"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)/g)].map((m) => m[1].replace(/&amp;/g, "&"));
};

describe("module tabs by role", () => {
  it("lists Integrations and Team & Access only for Super Admins with the mode on", () => {
    for (const [role, viewer] of Object.entries(ROLES)) {
      const want = viewer?.on ? ["Overview", "Integrations", "Account Brain", "Settings", "Team & Access"] : ["Overview", "Account Brain", "Settings"];
      expect(labels(shown(admin.items, true, "/admin", viewer)), role).toEqual(want);
      expect(tabsOn("/admin", viewer), role).toEqual(want);
    }
  });

  it("hides it when the mode is off, but keeps it while a Super Admin is on the page (it offers the switch)", () => {
    const off = { can: true, on: false };
    expect(labels(shown(admin.items, true, "/admin", off))).not.toContain("Team & Access");
    expect(labels(shown(admin.items, true, "/team", off))).toContain("Team & Access");
    expect(labels(shown(admin.items, true, "/team/client/test", off))).toContain("Team & Access");
    // Someone who can never be a Super Admin doesn't get the tab even on its address.
    expect(labels(shown(admin.items, true, "/team", ROLES.rep))).not.toContain("Team & Access");
    expect(labels(shown(admin.items, true, "/team", undefined))).not.toContain("Team & Access");
  });

  it("leaves every other module the same for every role", () => {
    for (const s of SECTIONS.filter((x) => x.key !== "admin")) {
      const seen = Object.values(ROLES).map((v) => labels(shown(s.items, true, s.items[0].href, v)).join("|"));
      expect(new Set(seen).size, s.key).toBe(1);
    }
  });

  it("still hides extras until they are switched on, except the one being viewed", () => {
    const prospecting = SECTIONS.find((s) => s.key === "prospecting")!;
    expect(labels(shown(prospecting.items, false, "/import"))).toEqual(["All ways in", "Upload CSV", "Describe companies", "Website visitors"]);
    expect(labels(shown(prospecting.items, false, "/discover"))).toContain("Market signals");
    expect(labels(shown(prospecting.items, true, "/import"))).toContain("Lookalikes");
  });
});

describe("top-bar trail and active tab", () => {
  it("marks the page being viewed as current", () => {
    path = "/crm/opportunities";
    const html = renderToStaticMarkup(<AppNav counts={counts} discover={0} sellerName="A" superAdmin={ROLES.rep} />);
    expect(html).toMatch(/<span aria-current="page" title="Deals">Deals<\/span>/);
    expect(html).toMatch(/class="nav-page on" aria-current="page"[^>]*>[\s\S]*?Deals/);
  });

  it("below a page (a company, a person, a client's settings) links back up instead of claiming to be that page", () => {
    for (const [at, crumb] of [["/accounts/abc", "Accounts"], ["/people/abc", "People"], ["/settings/seller", "Settings"], ["/team/client/test", "Team & Access"]] as const) {
      path = at;
      const html = renderToStaticMarkup(<AppNav counts={counts} discover={0} sellerName="A" superAdmin={ROLES["full Super Admin"]} />);
      const trail = html.match(/<nav class="nav-crumbs"[\s\S]*?<\/nav>/)![0];
      expect(trail, at).not.toContain('aria-current="page"');
      expect(trail, at).toMatch(new RegExp(`<a href="[^"]+">${crumb.replace("&", "&amp;")}</a>`));
      expect(html, at).not.toMatch(/class="nav-page on" aria-current="page"/);
    }
  });

  it("places every page in one module (the map behind the trail)", () => {
    expect(locate("/crm/opportunities").page?.label).toBe("Deals");
    expect(locate("/discover").section?.label).toBe("Prospecting");
    expect(locate("/analytics").page?.label).toBe("What's working");
    expect(locate("/team/client/x").page?.label).toBe("Team & Access");
  });
});

describe("command palette pages", () => {
  it("lists every page once (no duplicate import pages)", () => {
    const ids = palettePages(true, true).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(palettePages(true, true).find((p) => p.href === "/import/upload")?.sub).toBe("Prospecting");
  });

  it("offers Team & Access only in Super Admin mode, and extras only when switched on", () => {
    expect(palettePages(true, false).map((p) => p.label)).not.toContain("Team & Access");
    expect(palettePages(true, true).map((p) => p.label)).toContain("Team & Access");
    expect(palettePages(false, true).map((p) => p.href)).not.toContain("/discover");
  });
});
