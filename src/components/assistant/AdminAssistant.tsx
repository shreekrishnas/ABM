"use client";

// Super Admin assistant: a button in the bottom-right corner and a chat panel. Opening it only
// loads saved conversations from the database; the AI runs when a question is submitted.

import { useEffect, useRef, useState, useTransition } from "react";
import { Bot, ChevronDown, ChevronRight, Loader2, MessageSquarePlus, Send, X } from "lucide-react";
import { askAssistant, listAssistantConversations, loadAssistantConversation, type ChatMessage } from "./actions";

const EXAMPLES = ["Which Apollo enrichments failed this week, and why?", "Which CSV imports had rejected rows yesterday?", "How many companies entered the pipeline today?", "Which integrations are showing errors?"];

export function AdminAssistant() {
  const [open, setOpen] = useState(false);
  const [convos, setConvos] = useState<{ id: string; title: string; updatedAt: string }[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [busy, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) listAssistantConversations().then((c) => setConvos(c ?? []));
  }, [open]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages, busy]);

  const pick = (id: string) =>
    start(async () => {
      setError(null);
      setShowList(false);
      const m = await loadAssistantConversation(id);
      if (!m) return setError("Couldn't open that conversation.");
      setCurrent(id);
      setMessages(m);
    });

  const fresh = () => {
    setCurrent(null);
    setMessages([]);
    setError(null);
    setShowList(false);
  };

  const submit = (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setText("");
    setError(null);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content: question, answer: null, toolCalls: [], ms: null, at: new Date().toISOString() }]);
    start(async () => {
      const r = await askAssistant(current, question);
      if (!r.ok) return setError(r.error);
      setCurrent(r.conversationId);
      setMessages((m) => [...m, r.message]);
      listAssistantConversations().then((c) => setConvos(c ?? []));
    });
  };

  return (
    <>
      {!open && (
        <button className="assistant-fab" onClick={() => setOpen(true)} aria-label="Open the admin assistant" title="Admin assistant (Super Admin)">
          <Bot size={22} />
        </button>
      )}
      {open && (
        <section className="assistant-panel glass-modal" role="dialog" aria-label="Admin assistant">
          <header className="assistant-head">
            <div className="min-w-0">
              <div className="eyebrow">Super Admin · read-only</div>
              <button className="flex max-w-full items-center gap-1 truncate text-sm font-semibold" onClick={() => setShowList((s) => !s)} aria-expanded={showList}>
                {showList ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="truncate">{current ? (convos.find((c) => c.id === current)?.title ?? "Conversation") : "New conversation"}</span>
              </button>
            </div>
            <div className="flex gap-1">
              <button className="btn btn-icon" onClick={fresh} aria-label="New conversation" title="New conversation"><MessageSquarePlus size={17} /></button>
              <button className="btn btn-icon" onClick={() => setOpen(false)} aria-label="Close"><X size={17} /></button>
            </div>
          </header>

          {showList && (
            <ul className="assistant-list">
              {convos.length ? convos.map((c) => (
                <li key={c.id}><button className={`w-full truncate text-left text-sm ${c.id === current ? "font-semibold" : ""}`} onClick={() => pick(c.id)}>{c.title}<span className="secondary ml-2 text-xs">{new Date(c.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></button></li>
              )) : <li className="secondary text-sm">No earlier conversations.</li>}
            </ul>
          )}

          <div className="assistant-body">
            {!messages.length && (
              <div className="secondary grid gap-2 text-sm">
                <p>Ask about imports, Apollo, website visitors, the pipeline, integrations, jobs or errors. Answers come only from the platform's records; anything not recorded is said to be unknown.</p>
                {EXAMPLES.map((e) => <button key={e} className="assistant-example" onClick={() => submit(e)} disabled={busy}>{e}</button>)}
              </div>
            )}
            {messages.map((m) => (m.role === "user" ? <div key={m.id} className="assistant-q">{m.content}</div> : <AnswerView key={m.id} m={m} />))}
            {busy && <div className="secondary flex items-center gap-2 text-sm"><Loader2 size={15} className="animate-spin" /> Looking through the records…</div>}
            {error && <div className="assistant-error" role="alert">{error}</div>}
            <div ref={end} />
          </div>

          <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
            <textarea className="glass-input" rows={2} value={text} maxLength={2000} placeholder="Ask a question… (follow-ups keep the context)" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(text); } }} />
            <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()} aria-label="Send"><Send size={16} /></button>
          </form>
        </section>
      )}
    </>
  );
}

function AnswerView({ m }: { m: ChatMessage }) {
  const [tech, setTech] = useState(false);
  const a = m.answer;
  if (!a) return <div className="assistant-a whitespace-pre-wrap text-sm">{m.content}</div>;
  return (
    <div className="assistant-a text-sm">
      <div className="mb-1 font-semibold">{a.title}</div>
      {a.facts.length > 0 && (
        <dl className="assistant-facts">
          {a.facts.map((f, i) => <div key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
        </dl>
      )}
      <p className="whitespace-pre-wrap">{a.summary}</p>
      <Section title="Confirmed" items={a.confirmed} tone="var(--success)" />
      <Section title="Possible — needs checking" items={a.possible} tone="var(--warning)" />
      <Section title="Unknown" items={a.unknown} tone="var(--text-tertiary)" />
      {a.recommendedAction && <p className="mt-2"><span className="font-semibold">Recommended action: </span>{a.recommendedAction}</p>}
      <button className="secondary mt-2 flex items-center gap-1 text-xs" onClick={() => setTech((t) => !t)} aria-expanded={tech}>
        {tech ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Evidence: {m.toolCalls.length} lookup{m.toolCalls.length === 1 ? "" : "s"}, {a.references.length} record{a.references.length === 1 ? "" : "s"}{m.ms ? ` · ${(m.ms / 1000).toFixed(1)} s` : ""}
      </button>
      {tech && (
        <div className="assistant-tech">
          {a.references.length > 0 && (
            <ul>{a.references.map((r, i) => <li key={i}><span className="secondary">{r.type}</span> <code>{r.id}</code> {r.label}</li>)}</ul>
          )}
          <ul>{m.toolCalls.map((t, i) => <li key={i}><code>{t.tool}</code> <span className="secondary">{JSON.stringify(t.args)}</span> → {t.ok ? `${t.rows} row${t.rows === 1 ? "" : "s"}` : "failed"}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function Section({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <div className="text-xs font-semibold uppercase" style={{ color: tone }}>{title}</div>
      <ul className="list-disc pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}
