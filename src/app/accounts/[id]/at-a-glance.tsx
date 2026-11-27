import Link from "next/link";
import { ArrowRight, Compass, Target, UserRound, Zap } from "lucide-react";
import type { Glance, GlanceTone } from "@/lib/accounts/glance";

const TONE: Record<GlanceTone, { fg: string; bg: string }> = {
  good: { fg: "var(--success-strong)", bg: "var(--success-bg)" },
  maybe: { fg: "var(--warning-strong)", bg: "var(--warning-bg)" },
  weak: { fg: "var(--text-secondary)", bg: "var(--surface-card-header)" },
  stop: { fg: "var(--danger-strong)", bg: "var(--danger-bg)" },
  none: { fg: "var(--text-secondary)", bg: "var(--surface-card-header)" },
};

/** The four answers first: worth pursuing, why now, who to contact, what next. Details follow below. */
export function AtAGlance({ accountId, glance: g }: { accountId: string; glance: Glance }) {
  const t = TONE[g.verdict.tone];
  return (
    <section className="aag" aria-label="At a glance">
      <div className="aag-cell">
        <span className="aag-l"><Target size={14} aria-hidden /> Worth pursuing?</span>
        <span className="aag-pill" style={{ color: t.fg, background: t.bg }}>{g.verdict.label}</span>
        {g.verdict.why && <p className="aag-t aag-clamp" title={g.verdict.why}>{g.verdict.why}</p>}
      </div>
      <div className="aag-cell">
        <span className="aag-l"><Zap size={14} aria-hidden /> Why now</span>
        <p className="aag-t aag-clamp" title={g.whyNow ?? undefined}>{g.whyNow ?? <span className="muted">No buying signal found yet</span>}</p>
      </div>
      <div className="aag-cell">
        <span className="aag-l"><UserRound size={14} aria-hidden /> Who to contact</span>
        {g.contact ? (
          <>
            <Link href={`/accounts/${accountId}?tab=people`} className="aag-name">{g.contact.name}</Link>
            <p className="aag-t">{[g.contact.title, g.contact.role].filter(Boolean).join(" · ")}</p>
          </>
        ) : <p className="aag-t"><span className="muted">Not found yet</span></p>}
      </div>
      <div className="aag-cell aag-next">
        <span className="aag-l"><Compass size={14} aria-hidden /> Next step</span>
        <p className="aag-t aag-strong aag-clamp" title={g.next}>{g.next}</p>
        {g.next.startsWith("Review") && <Link href={`/accounts/${accountId}?tab=outreach`} className="aag-go">Open drafts <ArrowRight size={13} aria-hidden /></Link>}
      </div>
    </section>
  );
}

/** Plain meanings of the words the company page uses. */
export function Glossary() {
  return (
    <details className="aag-gloss">
      <summary>What do these words mean?</summary>
      <dl>
        <div><dt>Confirmed</dt><dd>Two independent sources, or the company&apos;s own website or filings, say so.</dd></div>
        <div><dt>Unconfirmed</dt><dd>One source says so. Worth checking before you rely on it.</dd></div>
        <div><dt>Disputed</dt><dd>Sources disagree. Never used in an email.</dd></div>
        <div><dt>Out of date</dt><dd>True once, but old enough that it may have changed.</dd></div>
        <div><dt>Fit</dt><dd>How well the company matches who your client sells to (size, industry, country).</dd></div>
        <div><dt>Intent</dt><dd>How strong the signs are that they need it now (news, hiring, website visits, replies).</dd></div>
        <div><dt>Priority</dt><dd>Fit, intent, company value and timing together. Higher means work on it sooner.</dd></div>
        <div><dt>Top, Mid, Broad priority</dt><dd>How much research each company gets: Top gets the deepest research.</dd></div>
        <div><dt>Account Brain</dt><dd>What your client sells and to whom. Every score is measured against it.</dd></div>
      </dl>
    </details>
  );
}
