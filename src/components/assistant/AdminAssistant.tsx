"use client";

// Super Admin assistant: a button in the bottom-right corner and a chat panel. Opening it only
// loads saved conversations from the database; the AI runs when a question is submitted.

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bot, CalendarDays, ChevronDown, ChevronRight, Loader2, MessageSquarePlus, Send, Star, X } from "lucide-react";
import { askAssistant, listAssistantConversations, listSavedQuestions, loadAssistantConversation, removeSavedQuestion, reportAssistantClientError, saveQuestion, weeklyDigestMessage, type ChatMessage } from "./actions";

/** Where a record named in an answer opens; unknown kinds stay plain text. */
function recordHref(type: string, id: string): string | null {
  const t = type.toLowerCase();
  if (/compan|account/.test(t)) return `/accounts/${encodeURIComponent(id)}`;
  if (/person|contact|people/.test(t)) return `/people/${encodeURIComponent(id)}`;
  if (/client/.test(t)) return `/team/client/${encodeURIComponent(id)}`;
  if (/deal|opportunit/.test(t)) return "/crm/opportunities";
  if (/hand/.test(t)) return "/handoffs";
  if (/draft|review|approval|decision/.test(t)) return "/review";
  if (/task/.test(t)) return "/crm/tasks";
  if (/import|batch/.test(t)) return "/import/upload";
  if (/error|run|job/.test(t)) return "/team?tab=system";
  if (/sign|audit/.test(t)) return "/team?tab=security";
  return null;
}

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
  const [saved, setSaved] = useState<{ id: string; text: string }[]>([]);
  const refreshSaved = () => listSavedQuestions().then(setSaved).catch(() => setSaved([]));

  useEffect(() => {
    if (open) {
      listAssistantConversations().then((c) => setConvos(c ?? [])).catch(() => setConvos([]));
      refreshSaved();
    }
  }, [open]);

  const digest = () =>
    start(async () => {
      setError(null);
      setShowList(false);
      const r = await weeklyDigestMessage(current).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
      if (!r.ok) return setError(r.error);
      setCurrent(r.conversationId);
      setMessages((m) => [...m, { id: `q-${Date.now()}`, role: "user", content: "This week", answer: null, toolCalls: [], ms: null, at: new Date().toISOString() }, r.message]);
      listAssistantConversations().then((c) => setConvos(c ?? [])).catch(() => {});
    });
  const star = (q: string) =>
    start(async () => {
      const r = await saveQuestion(q);
      if (!r.ok) setError(r.error ?? "Couldn't save it");
      await refreshSaved();
    });
  const unstar = (id: string) =>
    start(async () => {
      await removeSavedQuestion(id);
      await refreshSaved();
    });
  const isSaved = (q: string) => saved.some((s) => s.text === q.trim());
  // Braces matter: newer browsers return a promise from scrollIntoView, and React would treat it as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  const pick = (id: string) =>
    start(async () => {
      setError(null);
      setShowList(false);
      const m = await loadAssistantConversation(id).catch(() => null);
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
      let r: Awaited<ReturnType<typeof askAssistant>>;
      try {
        r = await askAssistant(current, question);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        reportAssistantClientError(`askAssistant call failed: ${msg}`, "").catch(() => {});
        return setError(`The request didn't complete (${msg.slice(0, 160)}). If you asked a question, its answer may already be saved: reopen the conversation from the list.`);
      }
      if (!r.ok) return setError(r.error);
      setCurrent(r.conversationId);
      setMessages((m) => [...m, r.message]);
      listAssistantConversations().then((c) => setConvos(c ?? [])).catch(() => {});
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
              <button className="btn btn-icon" onClick={digest} disabled={busy} aria-label="This week" title="This week: a summary from the records (no AI)"><CalendarDays size={17} /></button>
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
                <button className="assistant-example asst-digest" onClick={digest} disabled={busy}><CalendarDays size={15} /> <span><b>This week</b><small>A summary of every client from the records. No AI needed.</small></span></button>
                {saved.length > 0 && <div className="asst-label">Saved questions</div>}
                {saved.map((s) => (
                  <div key={s.id} className="asst-saved">
                    <button className="assistant-example" onClick={() => submit(s.text)} disabled={busy}><Star size={13} className="asst-star on" /> {s.text}</button>
                    <button className="btn btn-icon btn-sm" onClick={() => unstar(s.id)} aria-label={`Remove saved question: ${s.text}`} title="Remove"><X size={14} /></button>
                  </div>
                ))}
                <div className="asst-label">Examples</div>
                {EXAMPLES.map((e) => <button key={e} className="assistant-example" onClick={() => submit(e)} disabled={busy}>{e}</button>)}
              </div>
            )}
            {messages.map((m) => (m.role === "user" ? (
              <div key={m.id} className="assistant-q">{m.content}{m.content !== "This week" && (
                <button className="asst-starbtn" onClick={() => (isSaved(m.content) ? unstar(saved.find((s) => s.text === m.content.trim())!.id) : star(m.content))} aria-label={isSaved(m.content) ? "Remove from saved questions" : "Save this question"} title={isSaved(m.content) ? "Saved: click to remove" : "Save this question"}>
                  <Star size={13} className={`asst-star${isSaved(m.content) ? " on" : ""}`} />
                </button>
              )}</div>
            ) : <AnswerView key={m.id} m={m} />))}
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
      {a.recommendedAction && <p className="mt-2 whitespace-pre-wrap"><span className="font-semibold">{a.recommendedAction.startsWith("Needs attention") ? "" : "Recommended action: "}</span>{a.recommendedAction}</p>}
      {a.references.length > 0 && (
        <div className="asst-refs">
          {a.references.map((r, i) => {
            const href = recordHref(r.type, r.id);
            return href ? <Link key={i} href={href} className="asst-ref" title={`${r.type} ${r.id}`}>{r.label || r.id} ›</Link> : <span key={i} className="asst-ref plain" title={`${r.type} ${r.id}`}>{r.label || r.id}</span>;
          })}
        </div>
      )}
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
