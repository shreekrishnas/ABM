// "Why this email": the brief an email was written from, shown where people approve it.
import { ExternalLink } from "lucide-react";
import type { DraftBrief } from "@/lib/outreach/brief";

export function WhyThisEmail({ brief }: { brief: DraftBrief | null | undefined }) {
  if (!brief?.whyNow) return null;
  const host = (() => { try { return brief.whyNow.url ? new URL(brief.whyNow.url).hostname.replace(/^www\./, "") : null; } catch { return null; } })();
  return (
    <section className="wte" aria-label="Why this email">
      <h3 className="wte-h">Why this email</h3>
      <dl className="wte-grid">
        <div><dt>Why this person</dt><dd>{brief.whyPerson.role}{brief.whyPerson.title ? ` · ${brief.whyPerson.title}` : ""}{brief.whyPerson.cares.length ? <span className="wte-sub">Cares about {brief.whyPerson.cares.join(", ")}</span> : null}</dd></div>
        <div><dt>Why now</dt><dd>{brief.whyNow.claim}
          <span className="wte-sub">
            {brief.whyNow.date}{brief.whyNow.confidence != null ? ` · confidence ${brief.whyNow.confidence}` : ""}{brief.whyNow.verified ? " · verified" : ""}
            {brief.whyNow.url && <> · <a href={brief.whyNow.url} target="_blank" rel="noreferrer">{host ?? "source"} <ExternalLink size={10} /></a></>}
          </span>
          {brief.whyNow.quote && <q className="wte-q">{brief.whyNow.quote}</q>}
        </dd></div>
        <div><dt>Why us</dt><dd>{brief.whyUs.useCase ?? "—"}{brief.whyUs.pain ? <span className="wte-sub">Likely pain (asked, not stated): {brief.whyUs.pain}</span> : null}{brief.whyUs.proofPoint ? <span className="wte-sub">Proof point: {brief.whyUs.proofPoint}</span> : null}</dd></div>
        <div><dt>The ask</dt><dd>{brief.ask}</dd></div>
      </dl>
    </section>
  );
}
