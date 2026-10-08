import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { ImportWizard } from "@/components/import-wizard";
import { ActionButton } from "@/components/client";
import { Badge, Card, Empty, PageHeader, ago } from "@/components/ui";
import { processImportAction } from "../actions";

export const metadata = { title: "Import" };
// Each upload step is a short request; processing steps can take a while.
export const maxDuration = 300;

type Stats = Partial<Record<"accountsCreated" | "accountsUpdated" | "accountsUnchanged" | "contactsCreated" | "contactsUpdated" | "contactsUnchanged" | "skippedErased" | "journeysCreated" | "journeysUpdated", number>>;

export default async function ImportPage() {
  const [batches, queued, campaigns, senders] = await Promise.all([
    db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { campaign: true, sender: true } }),
    db.account.count({ where: { pipelineStatus: "queued", mergedIntoId: null } }),
    db.campaign.findMany({ where: { active: true }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
    db.senderProfile.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="Bring data in"
        title="Import Companies & People"
        sub="One CSV creates linked company and people records, assigns the campaign and LinkedIn sender profile you choose, and starts each person's journey. Re-upload any time — existing companies and people are updated, never duplicated."
        actions={<a href="/import/template" className="btn btn-secondary"><Download size={15} /> Download template</a>}
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Upload" className="xl:col-span-2">
          <ImportWizard campaigns={campaigns} senders={senders} />
        </Card>
        <Card title="How re-uploads work">
          <ul className="grid gap-2.5 text-sm secondary">
            <li><b style={{ color: "var(--text-primary)" }}>Companies</b> match on website, then company LinkedIn URL, then normalized name.</li>
            <li><b style={{ color: "var(--text-primary)" }}>People</b> match on LinkedIn URL, then email, then full name within the company.</li>
            <li><b style={{ color: "var(--text-primary)" }}>Journeys</b> are unique per person + campaign + sender. The same list for Sender 2 reuses the people and creates only Sender 2&apos;s journeys — Sender 1&apos;s activity is never overwritten.</li>
            <li><b style={{ color: "var(--text-primary)" }}>Stage.</b> LinkedIn activity columns set the starting stage; otherwise people start at Not Contacted. A reply&apos;s meaning sets the stage.</li>
            <li><b style={{ color: "var(--text-primary)" }}>Updating.</b> Newer non-blank values replace old ones. Blank cells never erase anything.</li>
            <li><b style={{ color: "var(--text-primary)" }}>Re-checking.</b> Only changed fields lose their verified status (e.g. a new job title is re-verified before any email).</li>
            <li><b style={{ color: "var(--text-primary)" }}>Automatic.</b> New and changed accounts run through the pipeline right after upload. Unchanged ones are skipped — no repeated spend.</li>
            <li><b style={{ color: "var(--text-primary)" }}>Strict.</b> Only mapped, predefined fields are stored; other columns are ignored and listed. Rows with invalid values are rejected with the row number and reason.</li>
            <li><b style={{ color: "var(--text-primary)" }}>Safe.</b> People erased under GDPR are never re-imported; unsubscribed people stay suppressed.</li>
          </ul>
          {queued > 0 && (
            <div className="mt-4 rounded-xl px-3 py-3 text-sm" style={{ background: "var(--surface-card-header)" }}>
              <div className="mb-2 secondary"><b style={{ color: "var(--text-primary)" }}>{queued}</b> account{queued === 1 ? "" : "s"} waiting to be processed.</div>
              <ActionButton action={async () => { "use server"; const r = await processImportAction(); return { ok: true, message: `Processed ${r.processed}; ${r.remaining} remaining` }; }} className="btn btn-primary btn-sm">Process now</ActionButton>
            </div>
          )}
        </Card>
      </div>

      <Card title="Import history" pad={false} className="mt-5">
        {batches.length === 0 ? <Empty title="No imports yet" sub="Download the template, fill it in, and upload it above." /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>File</th><th>Campaign · sender</th><th>Status</th><th>Rows</th><th>Saved</th><th>Rejected</th><th>Companies new / updated / same</th><th>People new / updated / same</th><th>Journeys new / updated</th><th>Ignored columns</th><th>When</th></tr></thead>
              <tbody>
                {batches.map((b) => {
                  const s = b.stats as Stats;
                  const errs = b.errors as { row: number; error: string }[];
                  return (
                    <tr key={b.id}>
                      <td className="strong mono">{b.filename}<div className="muted max-w-[260px] truncate text-[0.7rem] font-normal" title={errs.map((e) => `Row ${e.row}: ${e.error}`).slice(0, 10).join("\n")}>{errs[0] ? `Row ${errs[0].row}: ${errs[0].error}` : ""}</div></td>
                      <td className="text-xs">{b.campaign?.name ?? "—"}<div className="muted">{b.sender?.name ?? ""}</div></td>
                      <td><Badge color={b.status === "done" ? "#059669" : b.status === "processing" ? "#0EA5E9" : b.status === "failed" ? "#DC2626" : "#B45309"}>{b.status === "processing" ? `processing ${b.processed}/${b.toProcess}` : b.status}</Badge></td>
                      <td className="tnum">{b.rows}</td>
                      <td className="tnum">{b.accepted}</td>
                      <td className="tnum">{b.rejected ? <Badge color="#DC2626">{b.rejected}</Badge> : 0}</td>
                      <td className="tnum">{s.accountsCreated ?? 0} / {s.accountsUpdated ?? 0} / {s.accountsUnchanged ?? 0}</td>
                      <td className="tnum">{s.contactsCreated ?? 0} / {s.contactsUpdated ?? 0} / {s.contactsUnchanged ?? 0}</td>
                      <td className="tnum">{s.journeysCreated ?? 0} / {s.journeysUpdated ?? 0}</td>
                      <td className="max-w-[180px] truncate text-xs" title={b.ignoredColumns.join(", ")}>{b.ignoredColumns.length ? b.ignoredColumns.join(", ") : "—"}</td>
                      <td className="muted whitespace-nowrap text-xs">{ago(b.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
