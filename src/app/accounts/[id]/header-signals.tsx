import { ExternalLink } from "lucide-react";
import type { Account, Evidence } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { ago, date } from "@/components/ui";
import type { StoredBrief } from "@/lib/brain/strategist";

type Tone = "ok" | "warn" | "risk" | "muted";
const CHIP: Record<string, { label: string; tone: Tone }> = {
  verified: { label: "verified", tone: "ok" },
  probable: { label: "single source", tone: "warn" },
  conflicting: { label: "disputed", tone: "risk" },
  stale: { label: "dated", tone: "muted" },
  invalid: { label: "wrong", tone: "risk" },
  unknown: { label: "unchecked", tone: "muted" },
};

/** Can this company receive outreach right now, and if not, why. Code decides; this only explains it. */
async function eligibility(a: Account, now: Date): Promise<{ label: string; why: string; tone: Tone }> {
  if (a.doNotContact) return { label: "Do not contact", why: "Marked do-not-contact", tone: "risk" };
  if (a.stage === "DISQUALIFIED") return { label: "Ruled out", why: a.disqualifyReason ?? "Outside the targeting rule", tone: "risk" };
  if (["MQA", "OPPORTUNITY", "CUSTOMER"].includes(a.stage) || a.relationship !== "prospect") return { label: "With sales", why: "Handed off: automated outreach is off", tone: "muted" };
  if (a.outreachPausedUntil && a.outreachPausedUntil > now) return { label: `Paused until ${date(a.outreachPausedUntil)}`, why: a.outreachPauseReason ?? "Company pause", tone: "warn" };
  if (a.stage === "WATCH") return { label: "Watching", why: "Waiting for a better moment (re-check date on the watchlist)", tone: "warn" };
  const ready = await db.contact.count({ where: { accountId: a.id, mergedIntoId: null, state: { in: ["ready", "in_sequence"] } } });
  if (!ready) return { label: "No one to contact yet", why: a.pipelineStage >= 10 ? "Nobody passed readiness (verified email, lawful basis, not suppressed)" : "Research hasn't reached the buying group yet", tone: "muted" };
  return { label: "Eligible", why: `${ready} ${ready === 1 ? "person" : "people"} ready · max ${CONFIG.coordination.maxEmailsPerAccountPerDay} email a day`, tone: "ok" };
}

/**
 * The header's one-line strip: priority, then fit, intent, engagement and evidence kept separate
 * (no single blended AI score), where the company is in the flow, and whether it can be contacted.
 */
export async function HeaderSignals({ account: a, brief, intent, progress }: { account: Account; brief: StoredBrief | null; intent: { score: number; level: string } | null; progress: { step: number; steps: string[]; stopped: string | null } }) {
  const now = new Date();
  const [elig, latest, counts] = await Promise.all([
    eligibility(a, now),
    db.evidence.findFirst({ where: { accountId: a.id, flagged: false, supersededById: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.evidence.groupBy({ by: ["status"], where: { accountId: a.id, flagged: false, supersededById: null, isNegative: false }, _count: true }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const mqa = CONFIG.engagement.stages.MQA;
  const pp = a.priorityParts as { intent: number; fit: number; value: number; timing: number } | null;
  const cells: { label: string; value: string; unit?: string; note: string; tone?: string; title?: string; href?: string }[] = [
    { label: "Priority", value: a.priorityScore != null ? `${a.priorityScore}` : "—", note: pp ? `I ${pp.intent} · F ${pp.fit} · V ${pp.value} · T ${pp.timing}` : "Scored after research", title: "Intent, fit, company value and timing, weighted in the Account Brain" },
    { label: "Fit", value: a.fitScore != null ? `${a.fitScore}` : "—", unit: a.fitScore != null ? "/100" : "", note: a.tier ? `Tier ${a.tier}` : "Scored at step 3", href: "?tab=overview#fit" },
    { label: "Intent", value: intent ? `${intent.score}` : "—", unit: intent?.level, note: intent ? "Signals, decayed by age" : "Read after research", tone: intent?.level === "hot" ? "hot" : undefined },
    { label: "Engagement", value: `${Math.round(a.engagementScore)}`, unit: `/${mqa}`, note: a.engagementScore >= mqa ? "Hand-off reached" : `${Math.max(0, Math.round(mqa - a.engagementScore))} to hand-off`, href: "?tab=activity" },
    { label: "Evidence", value: `${n("verified")}`, unit: "verified", note: `${n("probable")} single · ${n("conflicting")} disputed${latest ? ` · ${ago(latest.createdAt)}` : ""}` },
  ];
  return (
    <div className="ch-strip" title={`Kept separate on purpose: fit says whether they match, intent whether now is the moment, engagement whether they respond, evidence how much we can prove.${brief ? ` Research brief v${brief.version}.` : ""}`}>
      {cells.map((c) => {
        const body = (
          <>
            <span className="ch-l">{c.label}</span>
            <span className={`ch-v${c.tone ? ` ${c.tone}` : ""}`}><b className="tnum">{c.value}</b>{c.unit && <small>{c.unit}</small>}</span>
            <span className="ch-n">{c.note}</span>
          </>
        );
        return c.href ? <a key={c.label} href={c.href} className="ch-c" title={c.title}>{body}</a> : <div key={c.label} className="ch-c" title={c.title}>{body}</div>;
      })}
      <div className="ch-c" title={progress.stopped ?? progress.steps[progress.step]}>
        <span className="ch-l">Progress</span>
        <span className="ch-v"><b>{progress.steps[progress.step]}</b></span>
        <span className="ch-seg" aria-hidden>{progress.steps.map((s, i) => <i key={s} className={i < progress.step ? "on" : i === progress.step ? (progress.stopped ? "stop" : "now") : ""} />)}</span>
      </div>
      <div className={`ch-c ch-elig ${elig.tone}`} title={elig.why}>
        <span className="ch-l">Outreach</span>
        <span className="ch-v"><b>{elig.label}</b></span>
        <span className="ch-n">{elig.why}</span>
      </div>
    </div>
  );
}

/** "Why now" with the facts behind it: each claim links to its source, with how sure we are. */
export async function WhyNow({ brief, fallback }: { brief: StoredBrief | null; fallback: string | null }) {
  const ids = brief?.whyNow?.factIds ?? [];
  const facts: Pick<Evidence, "id" | "claim" | "status" | "sourceUrl" | "sourceType" | "publishedAt" | "flagged" | "supersededById">[] = ids.length
    ? await db.evidence.findMany({ where: { id: { in: ids } }, select: { id: true, claim: true, status: true, sourceUrl: true, sourceType: true, publishedAt: true, flagged: true, supersededById: true } })
    : [];
  if (!brief?.whyNow && !fallback) return null;
  return (
    <div className="wn">
      <p className="co-why"><b>Why now:</b> {brief?.whyNow?.text ?? fallback}</p>
      {facts.length > 0 ? (
        <ul className="wn-src">
          {facts.map((f) => {
            const chip = f.flagged ? { label: "marked wrong", tone: "risk" as Tone } : f.supersededById ? { label: "replaced", tone: "muted" as Tone } : CHIP[f.status] ?? CHIP.unknown;
            const host = (() => { try { return new URL(f.sourceUrl).hostname.replace(/^www\./, ""); } catch { return f.sourceType; } })();
            return (
              <li key={f.id}>
                <span className={`wn-chip ${chip.tone}`}>{chip.label}</span>
                <span className="min-w-0 flex-1 truncate" title={f.claim}>{f.claim}</span>
                <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="wn-link">{host} · {date(f.publishedAt)} <ExternalLink size={10} /></a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="wn-inf"><span className="wn-chip muted">inferred</span> Read from signals, not a sourced fact: treat as a reason to look, not proof of buying.</p>
      )}
    </div>
  );
}
