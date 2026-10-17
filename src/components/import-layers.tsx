// Shared pieces of the Import layers (/import, /import/upload, /import/lookalikes, /import/apollo):
// the trail back up, what a file needs, and the review step where found companies are sorted
// into "will be used", "needs a check" and "not considered" before anything is researched.

import Link from "next/link";
import { db } from "@/lib/db";
import { seller } from "@/lib/seller";
import { IMPORT_FIELDS } from "@/lib/import/fields";
import { ActionForm, SelectAll, SubmitButton } from "@/components/client";
import { Card } from "@/components/ui";
import { approveSuggestionsAction } from "@/app/actions";

/** The seller's targeting rule in words, e.g. "IN, more than 999 employees". */
export function ruleText(): string | null {
  const mh = seller().icp.mustHave;
  if (!mh) return null;
  return [mh.countries?.length ? mh.countries.join(" or ") : null, mh.minEmployees ? `more than ${(mh.minEmployees - 1).toLocaleString()} employees` : null].filter(Boolean).join(", ") || null;
}

const REQ_WORD = { required: "Required", recommended: "Recommended", optional: "Optional" } as const;

/** What a file needs, before anyone picks one: required, recommended and optional columns, with examples. */
export function ImportRequirements() {
  const rule = ruleText();
  const groups = ["Company", "People", "LinkedIn activity"] as const;
  return (
    <Card title="What your file needs" sub="Column names don't have to match: you map them in the next step. Only mapped columns are stored." className="mb-5">
      <div className="grid gap-4 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g} className="min-w-0">
            <div className="micro mb-2">{g}</div>
            <ul className="grid gap-1.5 text-sm">
              {IMPORT_FIELDS.filter((f) => f.group === g && (g !== "LinkedIn activity" || f.requirement !== "optional" || ["connectionSent", "lastReply", "stage"].includes(f.key))).map((f) => (
                <li key={f.key} className="flex min-w-0 items-baseline gap-2">
                  <span className={`req req-${f.requirement}`}>{REQ_WORD[f.requirement]}</span>
                  <span className="min-w-0 truncate" title={f.help || undefined}><b style={{ color: "var(--text-primary)" }}>{f.label}</b> <span className="muted text-xs">e.g. {f.example}</span></span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="sort-box ok"><div className="sort-t">Will be researched</div><div className="sort-s">Country and size known and inside your rule{rule ? ` (${rule})` : ""}.</div></div>
        <div className="sort-box wait"><div className="sort-t">Checked first</div><div className="sort-s">Country or size missing: imported, then checked during research.</div></div>
        <div className="sort-box no"><div className="sort-t">Not considered</div><div className="sort-s">Outside your rule. Kept on record, never researched or contacted.</div></div>
      </div>
    </Card>
  );
}

type Origin = "lookalike" | "website_visitor";

/** Found companies, sorted into what will be used and what won't, with one approval step. */
export async function SuggestionReview({ origin, seed, emptyText }: { origin: Origin; seed?: string; emptyText: string }) {
  const where = { sellerId: seller().id, origin, ...(seed ? { seed } : {}) };
  const rows = await db.prospectSuggestion.findMany({ where: { ...where, status: { in: ["new", "excluded", "added"] } }, orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: 120 });
  const fit = rows.filter((r) => r.status === "new" && r.country && r.employees != null);
  const check = rows.filter((r) => r.status === "new" && !(r.country && r.employees != null));
  const out = rows.filter((r) => r.status === "excluded");
  const added = rows.filter((r) => r.status === "added");
  const rule = ruleText();
  if (!rows.length) return <Card><p className="secondary text-sm">{emptyText}</p></Card>;

  const line = (r: (typeof rows)[number], pick: boolean) => (
    <li key={r.id} className="flex min-w-0 items-start gap-2.5 py-2">
      {pick && <input type="checkbox" name="ids" value={r.id} defaultChecked className="mt-1" aria-label={`Select ${r.name}`} />}
      <div className="min-w-0">
        <div className="truncate font-semibold" style={{ color: "var(--text-primary)" }}>{r.name}</div>
        <div className="muted truncate text-xs">{[r.domain, r.industry, r.country ?? "country unknown", r.employees != null ? `${r.employees.toLocaleString()} employees` : "size unknown"].filter(Boolean).join(" · ")}</div>
        {r.reason && <div className="text-xs" style={{ color: "var(--intent-hot)" }}>{r.reason}</div>}
        {!r.reason && r.whyNow && <div className="secondary line-clamp-2 text-xs">{r.whyNow}</div>}
      </div>
    </li>
  );

  return (
    <ActionForm action={approveSuggestionsAction}>
      <div className="micro mb-2">Sorted by your rule{rule ? ` · ${rule}` : ""}</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="sort-box ok">
          <div className="sort-n tnum">{fit.length}</div><div className="sort-t">Will be researched</div>
          <ul className="mt-2 divide-y" style={{ borderColor: "var(--glass-border)" }}>{fit.map((r) => line(r, true))}</ul>
        </section>
        <section className="sort-box wait">
          <div className="sort-n tnum">{check.length}</div><div className="sort-t">Needs a check</div>
          <div className="sort-s">Country or size unknown; research checks it first.</div>
          <ul className="mt-2 divide-y" style={{ borderColor: "var(--glass-border)" }}>{check.map((r) => line(r, true))}</ul>
        </section>
        <section className="sort-box no">
          <div className="sort-n tnum">{out.length}</div><div className="sort-t">Not considered</div>
          <div className="sort-s">Outside your rule; never researched.</div>
          <ul className="mt-2 divide-y" style={{ borderColor: "var(--glass-border)" }}>{out.map((r) => line(r, false))}</ul>
        </section>
      </div>
      {fit.length + check.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold"><SelectAll name="ids" /> Select all</label>
          <SubmitButton className="btn btn-primary">Approve selected — start research</SubmitButton>
          <span className="muted text-xs">Nothing is researched or contacted until you approve it.</span>
        </div>
      )}
      {added.length > 0 && <p className="muted mt-3 text-xs">{added.length} already approved — see <Link href="/accounts" className="underline">Companies</Link>.</p>}
    </ActionForm>
  );
}
