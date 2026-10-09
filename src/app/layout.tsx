import type { Metadata } from "next";
import { ensureSellerPacks, seller } from "@/lib/seller";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@fontsource-variable/fraunces/opsz.css";
import "./globals.css";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { db } from "@/lib/db";
import { ToastHost } from "@/components/client";

export const metadata: Metadata = {
  title: { default: "ABM Intelligence", template: "%s · ABM Intelligence" },
  description: "Account-based marketing pipeline, dashboard and CRM",
};

// Applied before paint so the theme never flashes.
const themeScript = `try{var t=localStorage.getItem("abm-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.dataset.theme="dark"}catch(e){}`;

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ensureSellerPacks();
  const [reviews, handoffs, tasks, discover] = await Promise.all([
    db.reviewItem.count({ where: { status: "open" } }),
    db.handoff.count({ where: { acknowledgedAt: null, blocked: false } }),
    db.task.count({ where: { status: { in: ["todo", "in_progress"] }, dueAt: { lte: new Date() } } }),
    db.prospectSuggestion.count({ where: { status: "new" } }).catch(() => 0),
  ]);
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning style={{ ["--font-fraunces" as string]: '"Fraunces Variable"' }}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="atmosphere" aria-hidden />
        <div className="app-outer">
          <div className="app-shell glass-panel">
            <Sidebar counts={{ review: reviews, handoffs, tasks }} sellerName={seller().name} />
            <div className="app-content">
              <Topbar discover={discover} />
              <main className="app-main" id="main">{children}</main>
            </div>
          </div>
        </div>
        <ToastHost />
      </body>
    </html>
  );
}
