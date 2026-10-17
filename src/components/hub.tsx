// One drill-down level: a heading and a set of cards, each opening the next level in this tab.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Icon } from "@/lib/nav";

export type HubCard = { href: string; icon: Icon; title: string; text: string; meta?: string; alert?: boolean };

export function Hub({ eyebrow, title, sub, cards, size = "md" }: { eyebrow: string; title: string; sub?: string; cards: HubCard[]; size?: "lg" | "md" }) {
  return (
    <div className={`page-enter hub hub-${size}`}>
      <header className="hub-head">
        <div className="micro">{eyebrow}</div>
        <h1 className="hub-title">{title}</h1>
        {sub && <p className="secondary hub-sub">{sub}</p>}
      </header>
      <div className={`hub-grid n${cards.length}`}>
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="layer-card">
            <span className="layer-icon" aria-hidden><c.icon size={size === "lg" ? 28 : 22} strokeWidth={1.6} /></span>
            <span className="layer-title">{c.title}</span>
            <span className="layer-text">{c.text}</span>
            <span className="layer-foot">
              <span className={`text-xs ${c.alert ? "layer-alert" : "muted"}`}>{c.meta ?? ""}</span>
              <ArrowRight size={16} className="layer-arrow" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
