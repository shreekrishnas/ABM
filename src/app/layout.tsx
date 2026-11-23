import { Suspense } from "react";
import { peopleInView } from "@/lib/people";
import type { Metadata } from "next";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSeller, resolveScope } from "@/lib/scope";
import "./globals.css";
import "./design.css";
import { AppNav } from "@/components/shell/AppNav";
import { Shell } from "@/components/shell/Shell";
import { getMe, signedOutOrRemoved } from "@/lib/me";
import { authRequired } from "@/lib/auth";
import { db } from "@/lib/db";
import { after } from "next/server";
import { requestOrigin } from "@/lib/action-utils";
import { ToastHost } from "@/components/client";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { QuickTask } from "@/components/shell/QuickTask";
import { UndoProvider } from "@/components/kit/undo";
import { VegaLauncher } from "@/components/vega/panel";
import { AssistantBoundary } from "@/components/assistant/AssistantBoundary";

export const metadata: Metadata = {
  title: { default: "ABM Intelligence", template: "%s · ABM Intelligence" },
  description: "Account-based marketing pipeline, dashboard and CRM",
};

// Applied before paint so the theme never flashes.
const themeScript = `try{if(localStorage.getItem("abm-nav")==="mini")document.documentElement.dataset.nav="mini";var t=localStorage.getItem("abm-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.dataset.theme="dark"}catch(e){}`;

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  // Signed out (the sign-in pages, or a session whose person was removed): nothing private is read,
  // so nothing private reaches the page or its data. Local previews without sign-in stay open.
  const open = Boolean(me) || !authRequired();
  if (open) await ensureSellerPacks();
  const [reviews, handoffs, tasks, discover] = !open ? [0, 0, 0, 0] : await Promise.all([
    import("@/lib/decisions").then((d) => d.waitingForYou()).then((w) => w.total),
    db.handoff.count({ where: { acknowledgedAt: null, blocked: false } }),
    db.task.count({ where: { status: { in: ["todo", "in_progress"] }, dueAt: { lte: new Date() } } }),
    db.prospectSuggestion.count({ where: { status: "new" } }).catch(() => 0),
  ]);
  // While people use the app, restart a background queue that has stopped (checked at most every 5 minutes).
  if (me) {
    const origin = await requestOrigin().catch(() => null);
    after(async () => {
      const { watchQueue } = await import("@/lib/queue/watchdog");
      await watchQueue(origin);
    });
  }
  if (open) await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const scope = open ? await resolveScope() : null;
  const extras = open ? await (await import("@/lib/extras")).showExtras() : false;
  const activeClient = open && scope?.active ? await db.client.findUnique({ where: { id: scope.active }, select: { name: true, status: true } }).catch(() => null) : null;
  const sp = open ? await activeSeller() : null;
  const team = open ? await peopleInView({ where: { email: { contains: "@" } } }).catch(() => []) : [];
  const access = me
    ? { name: me.name, email: me.email, canSuperAdmin: me.canSuperAdmin, superAdmin: me.superAdmin, clients: me.clients.map((c) => c.name), state: me.clients.length || me.superAdmin ? ("ok" as const) : ("noclient" as const), choices: scope?.choices ?? [], picked: scope?.active && scope.ids?.length === 1 ? scope.active : null, everyClient: Boolean(scope?.all) }
    : (await signedOutOrRemoved()) ? { name: "", email: "", canSuperAdmin: false, superAdmin: false, clients: [], state: "removed" as const, choices: [], picked: null, everyClient: false } : null;
  // The client Vega works on: the one picked, else the first the Super Admin covers.
  // (Without sign-in, as in local previews, there is no scope: use the active client, as Home does.)
  const vegaClient = me?.superAdmin
    ? (scope?.choices.find((c) => c.id === scope.active) ?? scope?.choices[0] ?? (!scope ? await (async () => { const { activeSellerId } = await import("@/lib/scope"); const id = await activeSellerId(); const c = await db.client.findUnique({ where: { id }, select: { id: true, name: true } }).catch(() => null); return c; })() : null))
    : null;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Geist and Geist Mono: the type pairing taste-skill dealt for this app */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400..600&family=Geist+Mono:wght@400..500&display=swap" rel="stylesheet" />
      </head>
      <body>
        {process.env.ABM_TEST_COPY === "true" && <div className="tc-ribbon" role="status">Test copy: sample data only. Nothing here is real and no emails are sent.</div>}
        <div className="atmosphere" aria-hidden />
        <a href="#main" className="skip-link">Skip to content</a>
        <Shell counts={{ review: reviews, handoffs, tasks }} access={access}>
          <AppNav superAdmin={me ? { can: me.canSuperAdmin, on: me.superAdmin } : undefined} extras={extras} counts={{ review: reviews, handoffs, tasks }} discover={discover} sellerName={sp?.name ?? ""} account={scope && scope.choices.length > 1 ? { name: scope.choices.find((c) => c.id === scope.active && scope.ids?.length === 1)?.name ?? "All my clients", many: true, choices: scope.choices, picked: scope.active && scope.ids?.length === 1 ? scope.active : null, everyClient: scope.all } : null} />
          <main className="app-main" id="main">{activeClient && activeClient.status !== "active" && <div className="ad-banner cs-banner" role="status"><b>{activeClient.name} is {activeClient.status}</b> <span>by an admin. Research and sending are stopped for it; everything stays readable.</span></div>}<UndoProvider>{children}</UndoProvider></main>
        </Shell>
        <ToastHost />
        {/* Vega on every page: Super Admins covering the client in view (re-checked on the server for every request it makes). */}
        {vegaClient && <AssistantBoundary><Suspense fallback={null}><VegaLauncher clientId={vegaClient.id} clientName={vegaClient.name} /></Suspense></AssistantBoundary>}
        <CommandPalette extras={extras} canAct={Boolean(access && access.state === "ok")} superAdmin={Boolean(me?.superAdmin)} />
        <QuickTask users={team} />
      </body>
    </html>
  );
}
