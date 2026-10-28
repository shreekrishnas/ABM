import type { Metadata } from "next";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSeller, resolveScope } from "@/lib/scope";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import "./design.css";
import { AppNav } from "@/components/shell/AppNav";
import { Shell } from "@/components/shell/Shell";
import { getMe, signedOutOrRemoved } from "@/lib/me";
import { db } from "@/lib/db";
import { ToastHost } from "@/components/client";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { QuickTask } from "@/components/shell/QuickTask";
import { UndoProvider } from "@/components/kit/undo";

export const metadata: Metadata = {
  title: { default: "ABM Intelligence", template: "%s · ABM Intelligence" },
  description: "Account-based marketing pipeline, dashboard and CRM",
};

// Applied before paint so the theme never flashes.
const themeScript = `try{if(localStorage.getItem("abm-nav")==="mini")document.documentElement.dataset.nav="mini";var t=localStorage.getItem("abm-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.dataset.theme="dark"}catch(e){}`;

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ensureSellerPacks();
  const [reviews, handoffs, tasks, discover] = await Promise.all([
    db.reviewItem.count({ where: { status: "open" } }),
    db.handoff.count({ where: { acknowledgedAt: null, blocked: false } }),
    db.task.count({ where: { status: { in: ["todo", "in_progress"] }, dueAt: { lte: new Date() } } }),
    db.prospectSuggestion.count({ where: { status: "new" } }).catch(() => 0),
  ]);
  const me = await getMe();
  const scope = await resolveScope();
  const sp = await activeSeller();
  const team = await db.user.findMany({ where: { status: "active", email: { contains: "@" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }).catch(() => []);
  const access = me
    ? { name: me.name, email: me.email, canSuperAdmin: me.canSuperAdmin, superAdmin: me.superAdmin, clients: me.clients.map((c) => c.name), state: me.clients.length || me.superAdmin ? ("ok" as const) : ("noclient" as const), choices: scope?.choices ?? [], picked: scope?.active && scope.ids?.length === 1 ? scope.active : null, everyClient: Boolean(scope?.all) }
    : (await signedOutOrRemoved()) ? { name: "", email: "", canSuperAdmin: false, superAdmin: false, clients: [], state: "removed" as const, choices: [], picked: null, everyClient: false } : null;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="atmosphere" aria-hidden />
        <a href="#main" className="skip-link">Skip to content</a>
        <Shell counts={{ review: reviews, handoffs, tasks }} access={access}>
          <AppNav counts={{ review: reviews, handoffs, tasks }} discover={discover} sellerName={sp.name} />
          <main className="app-main" id="main"><UndoProvider>{children}</UndoProvider></main>
        </Shell>
        <ToastHost />
        <CommandPalette canAct={Boolean(access && access.state === "ok")} />
        <QuickTask users={team} />
      </body>
    </html>
  );
}
