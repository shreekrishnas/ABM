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

/** Header strip: fit, intent, engagement and evidence kept separate (no single blended AI score), plus eligibility. */
export async function HeaderSignals({ account: a, brief, intent }: { account: Account; brief: StoredBrief | null; intent: { score: number; level: string } | null }) {
  const now = new Date();
  const [elig, latest, counts] = await Promise.all([
    eligibility(a, now),
    db.evidence.findFirst({ where: { accountId: a.id, flagged: false, supersededById: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.evidence.groupBy({ by: ["status"], where: { accountId: a.id, flagged: false, supersededById: null, isNegative: false }, _count: true }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const mqa = CONFIG.engagement.stages.MQA;
  const tiles = [
    { label: "Fit", value: a.fitScore != null ? `${a.fitScore}` : "—", unit: a.fitScore != null ? "/ 100" : "", note: a.tier ? `Tier ${a.tier} · against the targeting rule and Brain` : "Scored at stage 3", href: "?tab=overview#fit" },
    { label: "Buying intent", value: intent ? `${intent.score}` : "—", unit: intent ? intent.level : "", note: intent ? "Converging signals, decayed by age" : "Read after research", href: "?tab=overview" },
    { label: "Engagement", value: `${Math.round(a.engagementScore)}`, unit: `/ ${mqa}`, note: a.engagementScore >= mqa ? "Reached the hand-off threshold" : `${Math.max(0, Math.round(mqa - a.engagementScore))} points to hand-off`, href: "?tab=activity" },
    { label: "Evidence", value: `${n("verified")}`, unit: "verified", note: `${n("probable")} single source · ${n("conflicting")} disputed${latest ? ` · last found ${ago(latest.createdAt)}` : ""}`, href: "?tab=overview" },
  ];
  return (
    <div className="hs">
      <div className="hs-tiles">
        {tiles.map((t) => (
          <a key={t.label} href={t.href} className="hs-t">
            <span className="hs-l">{t.label}</span>
            <span className="hs-v"><b className="tnum">{t.value}</b>{t.unit && <small>{t.unit}</small>}</span>
            <span className="hs-n">{t.note}</span>
          </a>
        ))}
        <div className={`hs-t hs-elig ${elig.tone}`}>
          <span className="hs-l">Outreach</span>
          <span className="hs-v"><b>{elig.label}</b></span>
          <span className="hs-n">{elig.why}</span>
        </div>
      </div>
      <p className="hs-foot">Kept separate on purpose: fit says whether they match, intent whether now is the moment, engagement whether they respond, evidence how much we can prove. {brief ? `Research brief v${brief.version}.` : "No research brief yet."}</p>
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
