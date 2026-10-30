import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileText, History, Trash2, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { getMe } from "@/lib/me";
import { DEFAULT_SELLER_ID, ensureSellerPacks } from "@/lib/seller";
import { resolveScope } from "@/lib/scope";
import { BRAIN_SECTIONS, loadBrain, readSection, readiness } from "@/lib/seller/brain";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { PageHeader, ago } from "@/components/ui";
import { BrainSection } from "./brain-section";
import { addBrainFileAction, removeBrainFileAction } from "./actions";

export const metadata = { title: "Account Brain" };
export const maxDuration = 120;

/** The Account Brain: everything the app knows about an account, editable by the people assigned to it. */
export default async function BrainPage({ searchParams }: { searchParams: Promise<{ client?: string; s?: string }> }) {
  await ensureSellerPacks();
  const me = await getMe();
  const all = await db.client.findMany({ orderBy: { name: "asc" } });
  const mine = me ? (me.superAdmin ? all : all.filter((c) => me.clients.some((m) => m.id === c.id))) : all;
  const choices = mine.length ? mine : authRequired() ? [] : [{ id: DEFAULT_SELLER_ID, name: DEFAULT_SELLER_ID }];
  const { client: wanted, s: picked } = await searchParams;
  const active = (await resolveScope())?.active;
  const current = choices.find((c) => c.id === wanted) ?? choices.find((c) => c.id === active) ?? choices[0];
  if (!current) return <div className="page-enter"><PageHeader eyebrow="Account Brain" title="No account assigned" sub="Ask a Super Admin to add you to an account in Team & Access." /></div>;

  const [{ pack, savedAt, versions }, files] = await Promise.all([
    loadBrain(current.id),
    db.knowledgeDoc.findMany({ where: { sellerId: current.id, origin: "upload" }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, text: true, approved: true, createdAt: true } }),
  ]);
  const ready = readiness(pack);
  const canEdit = true;
  // Each section's state for the list on the left: what is still missing, or how much is in it.
  const status = BRAIN_SECTIONS.map((s) => {
    const missing = ready.missing.filter((m) => m.startsWith(`${s.label}:`)).length;
    // Sections research runs without (defaults apply when empty).
    const optional = s.key === "lookalikes" || s.help.startsWith("Optional");
    const items = readSection(pack, s.key);
    const filled = s.single ? s.fields.filter((f) => { const v = items[0]?.[f.key]; return Array.isArray(v) ? v.length > 0 : v != null && v !== ""; }).length : items.length;
    return { key: s.key, label: s.label, missing, note: missing ? `${missing} to add` : s.single ? (filled ? "Done" : optional ? "Optional" : "Empty") : filled ? String(filled) : optional ? "Optional" : "Empty" };
  });
  const sectionOf = (m: string) => BRAIN_SECTIONS.find((s) => m.startsWith(`${s.label}:`))?.key;
  const tab = picked === "files" || BRAIN_SECTIONS.some((s) => s.key === picked) ? picked! : (status.find((x) => x.missing)?.key ?? "overview");
  const href = (s: string) => `/brain?${new URLSearchParams({ ...(wanted ? { client: wanted } : {}), s })}`;

  return (
    <div className="page-enter br">
      <PageHeader
        eyebrow="Account Brain"
        title={pack.name || current.name}
        sub="Everything the research, scoring and writing rely on. Change anything: add, edit, replace or remove items, upload files, or let the AI suggest from the website and files. Every save is kept as a version."
        actions={choices.length > 1 ? (
          <nav className="br-clients" aria-label="Accounts">{choices.map((c) => <Link key={c.id} href={`/brain?client=${c.id}`} className={c.id === current.id ? "on" : ""}>{c.name}</Link>)}</nav>
        ) : undefined}
      />

      <div className={`br-ready${ready.ready ? " ok" : ""}`}>
        {ready.ready ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        <div className="min-w-0 flex-1">
          <b>{ready.ready ? "Ready: research and drafting use this brain" : `Draft: ${ready.missing.length} thing${ready.missing.length === 1 ? "" : "s"} to add before research can run`}</b>
          {!ready.ready && <ul>{ready.missing.slice(0, 8).map((m) => <li key={m}>{sectionOf(m) ? <Link href={href(sectionOf(m)!)}>{m}</Link> : m}</li>)}</ul>}
        </div>
        <span className="br-meta"><History size={13} /> {versions ? `${versions} version${versions === 1 ? "" : "s"} · last saved ${ago(savedAt)}` : "Built-in, not edited yet"}</span>
      </div>

      <div className="br-layout">
      <nav className="br-side" aria-label="Brain sections">
        {status.map((x) => (
          <Link key={x.key} href={href(x.key)} className={`${tab === x.key ? "on" : ""}${x.missing ? " todo" : ""}`} aria-current={tab === x.key ? "page" : undefined}>
            <span>{x.label}</span><small>{x.note === "Done" ? "✓" : x.note}</small>
          </Link>
        ))}
        <Link href={href("files")} className={tab === "files" ? "on" : ""} aria-current={tab === "files" ? "page" : undefined}><span>Files</span><small>{files.length || "Empty"}</small></Link>
      </nav>

      <div className="br-main">
        {BRAIN_SECTIONS.filter((s) => s.key === tab).map((s) => <BrainSection key={`${current.id}-${s.key}-${savedAt?.getTime() ?? 0}`} clientId={current.id} spec={s} initial={readSection(pack, s.key)} canEdit={canEdit} />)}

        {tab === "files" && (
        <section className="br-card" id="brain-files">
          <header className="br-head"><div><h2>Files <span className="br-count tnum">{files.length}</span></h2><p>Brochures, case studies, decks, notes. AI fill reads them; the writer quotes approved ones.</p></div></header>
          <ActionForm action={addBrainFileAction.bind(null, current.id)} className="br-upload">
            <label className="br-drop"><Upload size={18} /><span>Choose a PDF, Word, text or CSV file</span><input type="file" name="file" accept=".pdf,.docx,.txt,.md,.csv,.html,.htm" /></label>
            <input name="title" className="glass-input" placeholder="Title (optional)" aria-label="Title" />
            <textarea name="text" className="glass-input br-area" rows={3} placeholder="…or paste text here" aria-label="Pasted text" />
            <label className="br-check"><input type="checkbox" name="approved" /> Approved: claims in it may be stated in emails</label>
            <SubmitButton className="btn btn-primary btn-sm">Add file</SubmitButton>
          </ActionForm>
          <ul className="br-list">
            {files.map((f) => (
              <li key={f.id} className="br-item">
                <div className="br-item-row">
                  <FileText size={15} className="br-file-ic" />
                  <span className="br-item-title static">{f.title}<small>{f.approved ? "Approved · " : ""}{Math.round(f.text.length / 1000)}k characters · {ago(f.createdAt)}</small></span>
                  <ActionButton action={removeBrainFileAction.bind(null, current.id, f.id)} className="br-icon" confirm={`Remove "${f.title}"?`} title="Remove"><Trash2 size={15} /></ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
        )}
      </div>
      </div>
      {current.id === DEFAULT_SELLER_ID && <p className="muted mt-4 text-xs">Writing rules, research questions and the full version history: <Link href="/settings/seller/edit" className="underline">advanced editor</Link>.</p>}
    </div>
  );
}
