"use client";

import { useState, useTransition } from "react";
import { FileUp, Loader2, Search } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/client";
import { addDocumentAction, searchAction, type SearchHit } from "./actions";

export const KIND_LABEL: Record<string, string> = {
  playbook: "Playbook", persona: "Persona", objection: "Objection", example: "Example message", market_fact: "Market fact", norm: "Market norm",
  research: "Research", case_study: "Case study", product: "Product / use case", competitor: "Competitor", document: "Document",
};

/** Try the retrieval the writer uses: type what a message is about, see what comes back and why. */
export function KnowledgeSearch() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      setErr(null);
      const r = await searchAction(q, kind || undefined);
      if (r.ok) setHits(r.hits);
      else {
        setHits(null);
        setErr(r.message);
      }
    });
  return (
    <div className="grid gap-3">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <div className="relative min-w-[240px] flex-[3]">
          <Search size={15} className="muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input className="glass-input" style={{ paddingLeft: 34 }} value={q} onChange={(e) => { setQ(e.target.value); setErr(null); }} placeholder="e.g. CFO worried about failed vendor payments" aria-label="Search the knowledge base" />
        </div>
        <select className="glass-select min-w-[160px] flex-1" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Only this kind">
          <option value="">Everything</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-primary" disabled={pending}>{pending ? <Loader2 size={15} className="spin" /> : <Search size={15} />} Search</button>
      </form>
      {err && <p className="text-xs" style={{ color: "var(--stop, #DC2626)" }} role="alert">{err}</p>}
      {hits && hits.length === 0 && <p className="muted text-sm">Nothing relevant found.</p>}
      {hits && hits.length > 0 && (
        <ol className="grid gap-2.5">
          {hits.map((h, i) => (
            <li key={i} className="rounded-xl px-3.5 py-3" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-sm" style={{ color: "var(--text-primary)" }}>{h.title}</b>
                <span className="chip">{KIND_LABEL[h.kind] ?? h.kind}</span>
                {h.approved && <span className="chip" style={{ ["--c" as string]: "#059669" }}>may be stated</span>}
                {h.origin !== "built_in" && <span className="chip" style={{ ["--c" as string]: "#4F46E5" }}>{h.origin === "learned" ? "learned" : "added"}</span>}
                <span className="muted ml-auto text-xs tnum">match {Math.round(h.score * 100)}</span>
              </div>
              <p className="secondary mt-1.5 whitespace-pre-line text-xs leading-relaxed">{h.text.length > 600 ? `${h.text.slice(0, 600)}…` : h.text}</p>
              {h.url && <a href={h.url} target="_blank" rel="noreferrer" className="muted mt-1 inline-block text-xs underline">Source</a>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Add a document: paste text or pick a .md / .txt file. */
export function AddDocumentForm() {
  return (
    <ActionForm action={addDocumentAction} className="grid gap-3">
      <DocFields />
    </ActionForm>
  );
}

/** Inside the form, so a successful add (which remounts the form) clears the fields. */
function DocFields() {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [fileErr, setFileErr] = useState<string | null>(null);
  return (
    <>
      <div className="grid gap-3 md:grid-cols-[1fr_200px]">
        <label className="grid gap-1.5">
          <span className="text-[0.8rem] font-semibold" style={{ color: "var(--text-primary)" }}>Title</span>
          <input name="title" className="glass-input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. HCCB case study (full)" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[0.8rem] font-semibold" style={{ color: "var(--text-primary)" }}>Kind</span>
          <select name="kind" className="glass-select" defaultValue="document">
            {Object.entries(KIND_LABEL).filter(([k]) => k !== "research" && k !== "playbook").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className="flex items-center justify-between text-[0.8rem] font-semibold" style={{ color: "var(--text-primary)" }}>
          Text
          <span className="btn btn-ghost btn-sm relative cursor-pointer font-normal">
            <FileUp size={14} /> Load a .md or .txt file
            <input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" className="absolute inset-0 cursor-pointer opacity-0" aria-label="Load a text file" onChange={async (e) => {
              const f = e.target.files?.[0];
              setFileErr(null);
              if (!f) return;
              if (f.size > 300_000) return setFileErr("That file is over 300 KB — split it first");
              setText(await f.text());
              if (!title) setTitle(f.name.replace(/\.(md|markdown|txt)$/i, ""));
            }} />
          </span>
        </span>
        <textarea name="text" className="glass-textarea" rows={8} required value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a case study, call notes, an email that got a reply, objection answers… Headings (# Title) help it split well." />
        {fileErr && <span className="text-xs" style={{ color: "var(--stop, #DC2626)" }}>{fileErr}</span>}
        <span className="muted text-xs">{text ? `${text.split(/\s+/).filter(Boolean).length.toLocaleString()} words` : "Split into chunks of about 220 words and embedded when you add it."}</span>
      </label>
      <details className="more">
        <summary>When to use it (optional)</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="grid gap-1.5 text-xs"><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Channel</span>
            <select name="channel" className="glass-select" defaultValue=""><option value="">Any</option><option value="email">Email</option><option value="linkedin">LinkedIn</option></select>
          </label>
          <label className="grid gap-1.5 text-xs"><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Personas</span>
            <input name="personas" className="glass-input" placeholder="e.g. cfo_finance, cpo_procurement" />
          </label>
          <label className="grid gap-1.5 text-xs"><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Plays</span>
            <input name="plays" className="glass-input" placeholder="e.g. email_first, linkedin_connect" />
          </label>
          <label className="grid gap-1.5 text-xs md:col-span-3"><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Source link</span>
            <input name="url" className="glass-input" placeholder="https://…" />
          </label>
        </div>
      </details>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="approved" className="mt-1" />
        <span><b style={{ color: "var(--text-primary)" }}>Approved to state in messages</b><span className="muted block text-xs">Tick only for checked facts about Manch (a public case study, product details). Unticked documents are background: the writer learns from them but never quotes them.</span></span>
      </label>
      <SubmitButton className="btn btn-brand justify-self-start">Add to knowledge base</SubmitButton>
    </>
  );
}
