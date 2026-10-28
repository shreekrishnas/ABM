"use client";

import { useState } from "react";
import { Badge, ConfidenceTag, DataTable, DecisionCard, EmptyState, ErrorBanner, FilterBar, FormField, SkeletonRows, StickySaveBar, type Column } from "@/components/kit";

type Row = { id: string; name: string; domain: string; industry: string; employees: number; intent: number; status: string };
const ROWS: Row[] = [
  { id: "1", name: "Sahyadri Beverages", domain: "sahyadribev.in", industry: "Beverages", employees: 6500, intent: 44, status: "verified" },
  { id: "2", name: "SwiftMove Logistics", domain: "swiftmove.in", industry: "Logistics", employees: 5200, intent: 98, status: "probable" },
  { id: "3", name: "Shakti Steel", domain: "shaktisteel.in", industry: "Steel", employees: 8000, intent: 65, status: "conflicting" },
];
const cols: Column<Row>[] = [
  { key: "name", header: "Company", primary: true, cell: (r) => <><b>{r.name}</b><br /><span className="muted">{r.domain}</span></> },
  { key: "industry", header: "Industry", priority: 2, cell: (r) => r.industry },
  { key: "emp", header: "Employees", align: "right", priority: 3, cell: (r) => r.employees.toLocaleString() },
  { key: "intent", header: "Intent", align: "right", cell: (r) => <Badge tone={r.intent >= 70 ? "danger" : r.intent >= 40 ? "warning" : "info"}>{r.intent}</Badge> },
  { key: "conf", header: "Evidence", cell: (r) => <ConfidenceTag status={r.status} /> },
];

/** Every kit component, live, with its states. */
export function KitDemo() {
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [name, setName] = useState("Manch Technologies");
  const [saved, setSaved] = useState("Manch Technologies");
  const [status, setStatus] = useState<string | undefined>();
  const rows = ROWS.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="kit">
      <section><h2 className="card-title">FilterBar + DataTable</h2>
        <FilterBar search={{ value: q, onChange: setQ, placeholder: "Search company or domain…" }} resultCount={rows.length} activeCount={tier ? 1 : 0} onClear={() => setTier("")}
          drawer={<FormField label="Tier"><select className="glass-select" value={tier} onChange={(e) => setTier(e.target.value)}><option value="">Any tier</option><option>T1</option><option>T2</option><option>T3</option></select></FormField>} />
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} caption="Companies" empty={{ title: "No companies match", text: "Loosen a filter or clear the search." }} />
      </section>
      <section><h2 className="card-title">Loading, empty and error states</h2>
        <div className="kit-grid">
          <div className="k-table-wrap"><SkeletonRows rows={4} /></div>
          <div className="k-table-wrap"><EmptyState title="No decisions waiting" text="New ones appear here as research finishes." /></div>
        </div>
        <ErrorBanner variant="partial" detail="2 of 9 research steps failed for Aurobindo Pharma." onRetry={() => {}} />
        <ErrorBanner variant="stale" detail="Last research run: 2 days ago." />
      </section>
      <section><h2 className="card-title">DecisionCard with Undo</h2>
        <div className="kit-stack">
          <DecisionCard type="identity_conflict" title="Asha Mehta: company doesn't match other sources" context="Sahyadri Beverages · T1 · opened 5m ago" actions={[{ label: "Drop contact", run: () => {}, done: "Contact dropped" }, { label: "Confirm identity", kind: "primary", run: () => {}, done: "Identity confirmed" }]} />
          <DecisionCard type="possible_blocker" variant="banner" title="Possible blocker: acquired, reported by one source only" context="insolvencytracker.in · 13 Sep 2026" actions={[{ label: "Keep company", kind: "primary", run: () => {}, done: "Kept" }, { label: "Approve rejection", kind: "danger", run: () => {}, done: "Rejected" }]} />
          <DecisionCard type="contradiction" variant="queue" title="Sources disagree: partner network size" notInspected />
        </div>
      </section>
      <section><h2 className="card-title">FormField + StickySaveBar</h2>
        <div className="kit-grid">
          <FormField label="Account name" required hint="Shown in every email signature."><input className="glass-input" value={name} onChange={(e) => { setName(e.target.value); setStatus(undefined); }} /></FormField>
          <FormField label="Website" error="Enter a full website, like https://manchtech.com"><input className="glass-input" defaultValue="manchtech" /></FormField>
        </div>
        <StickySaveBar changed={name !== saved ? ["Overview"] : []} status={status} onDiscard={() => setName(saved)} onSave={() => { setSaved(name); setStatus("Saved"); }} />
      </section>
      <section><h2 className="card-title">Badges</h2>
        <div className="kit-row">{(["neutral", "accent", "success", "warning", "danger", "info"] as const).map((t) => <Badge key={t} tone={t}>{t}</Badge>)}{["verified", "probable", "conflicting", "stale"].map((s) => <ConfidenceTag key={s} status={s} />)}</div>
      </section>
    </div>
  );
}
