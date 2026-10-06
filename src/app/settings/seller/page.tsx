import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { seller } from "@/lib/seller";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Seller profile" };

const ROLE_COLOR = { decision_maker: "#4F46E5", champion: "#0D9488", influencer: "#64748B", budget_owner: "#B45309" } as const;

export default function SellerPage() {
  const sp = seller();
  const w = sp.icp.weights;
  return (
    <div className="page-enter">
      <Link href="/settings" className="btn btn-ghost btn-sm mb-3 -ml-2"><ArrowLeft size={14} /> Settings</Link>
      <PageHeader
        eyebrow="Seller profile · drives fit, research, buying groups and drafts"
        title={sp.name}
        sub={sp.summary}
        actions={<a href={sp.website} target="_blank" rel="noreferrer" className="btn btn-secondary"><ExternalLink size={15} /> Website</a>}
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Positioning" className="xl:col-span-2">
          <p className="secondary text-sm">{sp.positioning}</p>
          <div className="micro mb-2 mt-5">Products</div>
          <ul className="grid gap-2.5 md:grid-cols-2">
            {sp.products.map((p) => <li key={p.name} className="rounded-xl px-3.5 py-3 text-sm" style={{ background: "var(--surface-card-header)" }}><b style={{ color: "var(--text-primary)" }}>{p.name}</b><div className="secondary mt-0.5 text-xs leading-relaxed">{p.what}</div></li>)}
          </ul>
        </Card>
        <Card title="Proof points" sub="Approved collateral used in drafts">
          <ul className="grid gap-2 text-sm">
            {sp.proofPoints.map((p) => <li key={p.text} className="secondary">· {p.text} <span className="muted text-[0.7rem]">({p.source})</span></li>)}
          </ul>
          <div className="micro mb-1.5 mt-4">Reference customers</div>
          {sp.customers.map((c) => <div key={c.name} className="mb-1.5 text-xs secondary"><b style={{ color: "var(--text-primary)" }}>{c.name}</b> — {c.story}</div>)}
        </Card>
      </div>

      <Card title="How fit is scored" sub={`Weights: industry ${w.industry} · size ${w.size} · geography ${w.geography} · partner network ${w.partnerNetwork} · tech stack ${w.techStack} — scored on known fields only`} className="mt-5" pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Vertical</th><th>Tier</th><th>Partner network</th><th>Lead use cases</th><th>Matches industry text like</th></tr></thead>
            <tbody>
              {sp.icp.industries.map((i) => (
                <tr key={i.key}>
                  <td className="strong">{i.label}</td>
                  <td><Badge color={i.tier === "primary" ? "#059669" : "#0EA5E9"}>{i.tier}</Badge></td>
                  <td className="tnum">{Math.round(i.partnerIntensity * w.partnerNetwork)}/{w.partnerNetwork}</td>
                  <td className="text-xs">{i.useCases.map((u) => sp.useCases.find((x) => x.key === u)?.name).join(" · ")}</td>
                  <td className="muted text-xs">{i.match.slice(0, 5).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 px-5 py-4 text-xs secondary md:grid-cols-3">
          <div><b style={{ color: "var(--text-primary)" }}>Size:</b> {sp.icp.employees.sweetSpot.toLocaleString()}+ employees full marks; {sp.icp.employees.mid}+ strong; {sp.icp.employees.min}+ partial; below that 0.</div>
          <div><b style={{ color: "var(--text-primary)" }}>Geography:</b> {sp.icp.geos.primary.join(", ")} full; {sp.icp.geos.secondary.join(", ")} partial.</div>
          <div><b style={{ color: "var(--text-primary)" }}>Tech stack:</b> ERP present ({sp.icp.tech.erp.slice(0, 4).join(", ")}…) +6 · legacy MDM to replace ({sp.icp.tech.incumbents.slice(0, 3).join(", ")}…) +3 · DIY workflow tools +1.</div>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card title="Buying group personas" sub="Titles map to roles in stage 8" pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Role</th><th>Titles</th><th>Why they matter</th></tr></thead>
              <tbody>
                {sp.personas.map((p, i) => (
                  <tr key={i}>
                    <td><Badge color={ROLE_COLOR[p.role]}>{p.role.replace("_", " ")}</Badge></td>
                    <td className="text-xs">{p.titles.slice(0, 6).join(", ")}{p.titles.length > 6 ? "…" : ""}</td>
                    <td className="text-xs">{p.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Buying triggers" sub="What makes an account worth contacting now" pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Trigger</th><th>Why it matters to {sp.name}</th></tr></thead>
              <tbody>
                {sp.triggers.map((t) => <tr key={t.key}><td className="strong text-xs">{t.label}</td><td className="text-xs">{t.why}</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card title="Use cases & messaging" className="xl:col-span-2">
          <ul className="grid gap-3">
            {sp.useCases.map((u) => (
              <li key={u.key} className="rounded-xl px-3.5 py-3" style={{ background: "var(--surface-card-header)" }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2"><b className="text-sm" style={{ color: "var(--text-primary)" }}>{u.name}</b><span className="text-xs" style={{ color: "#059669" }}>{u.outcome}</span></div>
                <div className="muted mt-0.5 text-xs">Pain: {u.pains}</div>
                <div className="secondary mt-1.5 text-xs italic">“{sp.messaging.byUseCase[u.key]}”</div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="grid content-start gap-5">
          <Card title="Competitors" sub="How we position against them">
            <ul className="grid gap-2 text-xs">
              {sp.competitors.map((c) => <li key={c.name}><b style={{ color: "var(--text-primary)" }}>{c.name}</b> <span className="muted">({c.category})</span><div className="secondary">{c.angle}</div></li>)}
            </ul>
          </Card>
          <Card title="Disqualify or deprioritise when">
            <ul className="grid gap-1.5 text-xs secondary">{sp.negativeSignals.map((n) => <li key={n}>· {n}</li>)}</ul>
          </Card>
          <Card title="Sender details" sub="Required in every email">
            <div className="text-xs secondary">{sp.sender.name} · {sp.sender.company}<br />{sp.sender.address}</div>
            <p className="mt-2 text-xs" style={{ color: "#B45309" }}>Replace with the full registered postal address before real sending.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
