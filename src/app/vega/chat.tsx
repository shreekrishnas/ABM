"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Send } from "lucide-react";
import type { Answer } from "@/lib/assistant/run";
import { askVega, confirmVegaProposal, dismissVegaProposal, type VegaMessage } from "./actions";
import type { Proposal } from "@/lib/agent/proposals";

const STARTERS = (company: string | null) =>
  company
    ? [`Why is ${company} a priority?`, `Who is in ${company}'s buying group, and who is missing?`, `Research ${company} again`]
    : ["What changed in the last 24 hours?", "Show me the strongest emails to approve", "Which companies should we focus on this week, and why?"];

function refHref(r: Answer["references"][number]) {
  if (r.type === "company") return `/accounts/${r.id}`;
  if (r.type === "review") return `/review?pick=${r.id}`;
  return null;
}

function AnswerView({ a }: { a: Answer }) {
  return (
    <div className="jv-answer">
      <b className="jv-a-title">{a.title}</b>
      {a.facts.length > 0 && <dl className="jv-a-facts">{a.facts.map((f, i) => <div key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
      <p>{a.summary}</p>
      {a.confirmed.length > 0 && <div className="jv-a-sec ok"><span>Confirmed</span><ul>{a.confirmed.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      {a.possible.length > 0 && <div className="jv-a-sec maybe"><span>Possible, needs checking</span><ul>{a.possible.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      {a.unknown.length > 0 && <div className="jv-a-sec unk"><span>Unknown</span><ul>{a.unknown.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      {a.recommendedAction && <p className="jv-a-next"><b>Suggested next step:</b> {a.recommendedAction}</p>}
      {a.references.length > 0 && (
        <div className="jv-a-refs">{a.references.map((r, i) => { const h = refHref(r); return h ? <Link key={i} href={h}>{r.label}</Link> : <span key={i}>{r.label}</span>; })}</div>
      )}
    </div>
  );
}

/** A change Vega proposed. Nothing happens until the person confirms; the result is the real outcome. */
function ProposalCard({ p, clientId }: { p: Proposal; clientId: string }) {
  const [state, setState] = useState<{ status: string; outcome: string | null }>({ status: p.status, outcome: p.outcome ?? null });
  const [pending, start] = useTransition();
  const router = useRouter();
  const open = state.status === "awaiting_approval";
  return (
    <div className={`jv-prop ${state.status}`}>
      <div className="jv-prop-what"><b>{p.summary}</b><small>{p.costUsd ? `about $${p.costUsd.toFixed(2)}` : "free"} · {p.reversible ? "can be undone" : "can't be undone"}</small></div>
      {open ? (
        <div className="jv-prop-btns">
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => { const r = await confirmVegaProposal(clientId, p.id); setState({ status: r.ok ? "done" : r.status === "refused" ? "cancelled" : "failed", outcome: r.message }); router.refresh(); })}>{pending ? "Working…" : "Confirm"}</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => start(async () => { await dismissVegaProposal(clientId, p.id); setState({ status: "cancelled", outcome: "Dismissed" }); })}>Dismiss</button>
        </div>
      ) : <span className="jv-prop-out">{state.outcome ?? (state.status === "cancelled" ? "Dismissed" : state.status)}</span>}
    </div>
  );
}

export function VegaChat({ clientId, clientName, accountId, accountName, conversationId, initial }: { clientId: string; clientName: string; accountId: string | null; accountName: string | null; conversationId: string | null; initial: VegaMessage[] }) {
  const [messages, setMessages] = useState<VegaMessage[]>(initial);
  const [conv, setConv] = useState(conversationId);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, pending]);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    setError(null);
    setText("");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: question, answer: null, tools: [], proposals: [], ms: null, at: new Date().toISOString() }]);
    start(async () => {
      const r = await askVega({ clientId, conversationId: conv, accountId, question });
      if (!r.ok) { setError(r.error); return; }
      setMessages((m) => [...m, r.message]);
      if (!conv) {
        setConv(r.conversationId);
        router.replace(`/vega?${new URLSearchParams({ c: clientId, conv: r.conversationId, ...(accountId ? { a: accountId } : {}) })}`, { scroll: false });
      }
    });
  };

  return (
    <section className="jv-chat jv-card" aria-label="Conversation with Vega">
      <div className="jv-card-h"><h2>Ask Vega</h2><span className="muted text-xs">{clientName}{accountName ? ` · ${accountName}` : ""} · looks things up; changes need your Confirm</span></div>
      <div className="jv-msgs" aria-live="polite">
        {messages.length === 0 && (
          <div className="jv-empty">
            <p>Ask about your accounts. Answers come from the records, with the evidence linked.</p>
            <div className="jv-starters">{STARTERS(accountName).map((s) => <button key={s} type="button" className="jv-starter" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`jv-msg ${m.role}`}>
            {m.role === "user" ? <p>{m.content}</p> : m.answer ? <AnswerView a={m.answer} /> : <p>{m.content}</p>}
            {m.role === "assistant" && m.proposals.length > 0 && <div className="jv-props">{m.proposals.map((p) => <ProposalCard key={p.id} p={p} clientId={clientId} />)}</div>}
            {m.role === "assistant" && m.tools.length > 0 && <small className="jv-tools">Looked at: {[...new Set(m.tools.map((t) => t.tool.replaceAll("_", " ")))].join(", ")}{m.ms ? ` · ${(m.ms / 1000).toFixed(1)} s` : ""}</small>}
          </div>
        ))}
        {pending && <div className="jv-msg assistant jv-thinking" role="status">Looking it up…</div>}
        <div ref={end} />
      </div>
      {error && <p className="jv-error" role="alert">{error}</p>}
      <form className="jv-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} rows={2} maxLength={2000} placeholder={accountName ? `Ask about ${accountName}…` : "Ask about your accounts…"} aria-label="Your question" disabled={pending} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !text.trim()} aria-label="Send"><Send size={14} /></button>
      </form>
    </section>
  );
}
