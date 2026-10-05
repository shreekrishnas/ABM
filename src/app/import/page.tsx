import { FileSpreadsheet } from "lucide-react";
import { db } from "@/lib/db";
import { ActionForm, SubmitButton } from "@/components/client";
import { Badge, Card, Empty, PageHeader, ago } from "@/components/ui";
import { importCsvAction } from "../actions";

export const metadata = { title: "Import" };

const SAMPLE = `company,domain,industry,employees,country,name,email,title,phone
Northwind Analytics,northwind-analytics.com,analytics,850,US,Asha Mehta,asha.mehta@northwind-analytics.com,VP Data,+1 415 555 0134
Helios Fintech,https://www.heliosfintech.io/,fintech,1200,UK,Daniel Okafor,daniel.okafor@heliosfintech.io,Hd of Data Platform,`;

export default async function ImportPage() {
  const batches = await db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  return (
    <div className="page-enter">
      <PageHeader eyebrow="Stage 1 · Data input" title="Import accounts & contacts" sub="Upload a CSV from any source. Headers are matched loosely (Company Name, Work Email, Job Title…). Nothing is trusted: every field starts as unknown and keeps the file as its source." />
      <div className="grid gap-5 xl:grid-cols-5">
        <Card title="Upload CSV" className="xl:col-span-3">
          <ActionForm action={importCsvAction} className="grid gap-4">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-6 py-10 text-center" style={{ border: "1.5px dashed var(--border-default)", background: "var(--surface-card-header)" }}>
              <FileSpreadsheet size={28} style={{ color: "var(--accent-section)" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Choose a .csv file</span>
              <span className="muted text-xs">Up to 5 MB / 5,000 rows</span>
              <input type="file" name="file" accept=".csv,text/csv" required className="mt-2 text-xs secondary" />
            </label>
            <label className="flex items-center gap-2 text-sm secondary"><input type="checkbox" name="run" defaultChecked className="h-4 w-4 accent-indigo-500" /> Run the pipeline on imported accounts right away</label>
            <div className="flex justify-end"><SubmitButton className="btn btn-brand">Import</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card title="Accepted columns" className="xl:col-span-2">
          <ul className="grid gap-1.5 text-sm secondary">
            <li><b style={{ color: "var(--text-primary)" }}>company</b> (required) · domain / website · industry · employees (or a range like 200-500) · country</li>
            <li><b style={{ color: "var(--text-primary)" }}>name</b> · email · title · phone · linkedin · title date</li>
          </ul>
          <div className="micro mb-1.5 mt-4">Example</div>
          <pre className="mono overflow-x-auto rounded-xl p-3 text-[0.7rem] leading-relaxed secondary" style={{ background: "var(--surface-card-header)" }}>{SAMPLE}</pre>
          <p className="muted mt-3 text-xs">Same domain in two files becomes one account. Existing values are never overwritten, only gaps filled.</p>
        </Card>
      </div>
      <Card title="Import history" pad={false} className="mt-5">
        {batches.length === 0 ? <Empty title="No imports yet" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>File</th><th>Source</th><th>Rows</th><th>Accepted</th><th>Rejected</th><th>First error</th><th>When</th></tr></thead>
              <tbody>
                {batches.map((b) => {
                  const errs = b.errors as { row: number; error: string }[];
                  return (
                    <tr key={b.id}>
                      <td className="strong mono">{b.filename}</td>
                      <td>{b.source}</td>
                      <td className="tnum">{b.rows}</td>
                      <td className="tnum"><Badge color="#059669">{b.accepted}</Badge></td>
                      <td className="tnum">{b.rejected ? <Badge color="#DC2626">{b.rejected}</Badge> : 0}</td>
                      <td className="max-w-[280px] truncate text-xs">{errs[0] ? `Row ${errs[0].row}: ${errs[0].error}` : "—"}</td>
                      <td className="muted text-xs">{ago(b.createdAt)}</td>
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
