import { HomeDoc } from "./doc";
import { renderHtml } from "@/lib/html";
import { db } from "@/lib/db";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSeller } from "@/lib/scope";
import { commandCenter, companyFlow } from "@/lib/command-center";
import { openDecisions } from "@/lib/decisions";

const DAY = 86_400_000;
const MAIN = "Review decisions";

function ago(d: Date, now: Date) {
  const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
const initials = (s: string) => s.split(/[\s·&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Arrow() {
  return <svg className="m-arrow" viewBox="0 0 12 12" aria-hidden="true"><path className="m-arrow__stem" d="M1 6h8" /><path className="m-arrow__head" d="M4.5 2.5 8 6l-3.5 3.5" /></svg>;
}
const Check = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 8.2 2.3 2.3 4.7-5" /></svg>;

/** Home: today's decisions, where companies stop and this week, for the client in view. Served as static
 *  HTML (no React hydration) so the taste-skill kit's scripts own the DOM. */
export async function homeHtml(): Promise<string> {
  await ensureSellerPacks();
  const p = await activeSeller();
  const now = new Date();
  const [cc, flow, center] = await Promise.all([commandCenter(now), companyFlow(now), openDecisions("all", 14)]);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const [added, importedWeek] = await Promise.all([
    db.account.findMany({ where: { mergedIntoId: null, createdAt: { gte: weekAgo } }, select: { createdAt: true } }),
    db.account.count({ where: { mergedIntoId: null, createdAt: { gte: weekAgo } } }),
  ]);

  const n = flow.steps.map((_, i) => flow.accounts.filter((a) => a.reached >= i).length);
  let gap = -1;
  for (let i = 1; i < n.length; i++) if (n[i - 1] && (gap < 0 || n[i] / n[i - 1] < n[gap] / n[gap - 1])) gap = i;
  const rate = gap > 0 ? Math.round((n[gap] / n[gap - 1]) * 100) : 0;
  const stuck = gap > 0 ? n[gap - 1] - n[gap] : 0;
  const waiting = center.counts.all;
  const step = (i: number) => flow.steps[i]?.label ?? "";

  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(now.getTime() - (6 - i) * DAY);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + DAY);
    return added.filter((a) => a.createdAt >= start && a.createdAt < end).length;
  });
  const dayLabel = (i: number) => new Date(now.getTime() - (6 - i) * DAY).toLocaleDateString("en-GB", { weekday: "short" });
  const topDay = Math.max(1, ...days);

  const queue = center.items;
  const first = queue[0];
  const exceptions = center.counts.exception;
  const approvals = center.counts.approval;
  const signals = cc.attention.slice(0, 2);
  const flowShown = flow.steps;
  const runAt = gap > 0 ? gap : flowShown.length - 1;

  return "<!doctype html>" + renderHtml(
    <HomeDoc>
      <header className="nav">
        <div className="wrap nav__bar">
          <a className="skip-link" href="#top">Skip to content</a>
          <a className="nav__logo" href="#top"><span className="mark" data-mark="dots" aria-hidden="true" />ABM Intelligence</a>
          <nav className="nav__links" aria-label="Main">
            <div className="nav__item">
              <a className="nav__link" href="/accounts">Accounts <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></a>
              <div className="nav__menu">
                <div className="wrap grid">
                  <div className="menu-col span-3">
                    <p className="t-label">Accounts</p>
                    <a href="/accounts">Companies<span>Every target company</span></a>
                    <a href="/people">People<span>Contacts and their stage</span></a>
                    <a href="/signals">Signals<span>Buying signals by company</span></a>
                  </div>
                  <div className="menu-col span-3">
                    <p className="t-label">Prospect</p>
                    <a href="/import">Import<span>Upload or describe companies</span></a>
                    <a href="/discover">Discover<span>Companies like your best</span></a>
                  </div>
                </div>
              </div>
            </div>
            <div className="nav__item"><a className="nav__link" href="/import">Prospect</a></div>
            <div className="nav__item"><a className="nav__link" href="/work/today">Engage</a></div>
            <div className="nav__item"><a className="nav__link" href="/handoffs">Pipeline</a></div>
            <div className="nav__item"><a className="nav__link" href="/overview">Insights</a></div>
          </nav>
          <div className="nav__actions">
            <a className="btn btn--primary" href="/review">{MAIN}</a>
          </div>
          <button className="nav__toggle" type="button" aria-expanded="false" aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 5h14M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero hero--collage" data-enter aria-labelledby="hero-h">
          <div className="wrap"><div className="hero-text grid hero__grid">
            <div className="hero__text span-5">
              <h1 id="hero-h">Account intelligence for {p.name}</h1>
              <p className="hero__lead">{plural(waiting, "decision waits", "decisions wait")} for you today. Each target company is researched, its facts checked and its first email drafted; a person approves what goes out.</p>
              <div className="btn-row">
                <a className="btn btn--primary" href="/review">{MAIN}<Arrow /></a>
                <a className="btn btn--secondary" href="#flow">See the company flow</a>
              </div>
              <p className="hero__proof">{plural(n[0] ?? 0, "company", "companies")} in the program, counted from recorded events.</p>
            </div>
            <div className="hero__art span-6 start-7" role="img" aria-label={`The decision queue with ${waiting} open items, and the step where most companies stop`}>
              <div className="ly-piece ly-piece--main" aria-hidden="true">
                <div className="ui ui-panel ui-win" data-ui="window" data-open="Open" data-work="Checking" data-done="Decided">
                  <div className="ui-win__bar">
                    <span className="ui-dots" aria-hidden="true"><i /><i /><i /></span>
                    <span className="ui-win__crumb">{p.name} <i>/</i> <b>Decisions</b></span>
                    <span className="ui-spacer" />
                    <span className="ui-win__search" aria-hidden="true"><svg className="ui-icon" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg><span className="ui-win__ph">Search</span><span className="ui-kbd">/</span></span>
                  </div>
                  <div className="ui-win__body">
                    <nav className="ui-win__side" aria-hidden="true">
                      <span className="ui-win__nav is-on">All<em>{waiting}</em></span>
                      <span className="ui-win__nav">Exceptions<em>{exceptions}</em></span>
                      <span className="ui-win__nav">Approvals<em>{approvals}</em></span>
                      <span className="ui-win__label">Engage</span>
                      <span className="ui-win__nav"><span className="ui-win__hash">#</span>Replies</span>
                      <span className="ui-win__nav"><span className="ui-win__hash">#</span>Hand-offs</span>
                    </nav>
                    <div className="ui-win__main">
                      <div className="ui-win__cols" aria-hidden="true"><span>Company</span><span>Decision</span><span>Status</span><span>Age</span></div>
                      <ul className="ui-win__rows">
                        {queue.slice(0, 6).map((d, i) => (
                          <li key={d.id} className="ui-win__row" data-row><span className="ui-avatar" data-tone={(i % 5) + 1}>{initials(d.title)}</span><span className="ui-win__who">{d.title}</span><span className="ui-win__sub">{d.label}</span><span className={`ui-win__st${d.kind === "exception" ? " is-you" : ""}`} data-st>{d.kind === "exception" ? "Needs you" : "Open"}</span><span className="ui-win__age">{ago(d.createdAt, now)}</span></li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              {gap > 0 && (
                <div className="ly-piece ly-piece--note hb-card" aria-hidden="true" data-ly-steps="700">
                  <div className="hb-card__row"><h5>Biggest bottleneck</h5></div>
                  <div className="hb-line" data-step><i>!</i><span><b>{stuck}</b> {lower(step(gap - 1))}, not {lower(step(gap))}</span></div>
                  <div className="hb-line" data-step><i>%</i><span><b>{rate}%</b> move on to the next step</span></div>
                  <div className="hb-line" data-step><i>✓</i><span><b>{n[0]}</b> companies counted, none estimated</span></div>
                </div>
              )}
            </div>
          </div></div>
        </section>

        <section className="section" id="decisions" aria-labelledby="decisions-h">
          <div className="wrap">
            <div className="grid">
              <h2 id="decisions-h" className="span-5">Accounts waiting for a decision</h2>
              <p className="span-6 start-7">{plural(exceptions, "exception comes", "exceptions come")} from the fit rules and identity checks, {plural(approvals, "approval is", "approvals are")} emails and replies. Open one to read its sources, then approve it or rule it out.</p>
              <p className="span-6 start-7"><a className="link" href="/review">Open the decision queue</a></p>
            </div>
            <div className="ui app fill" role="img" aria-label={`The decision queue beside the oldest open decision${first ? `, ${first.title}` : ""}`} data-ui-pause-host>
              <div className="app__pane app__pane--list">
                <div className="ui ui-panel ui-win" data-ui="window" data-open="Open" data-work="Checking" data-done="Decided">
                  <div className="ui-win__bar">
                    <span className="ui-dots" aria-hidden="true"><i /><i /><i /></span>
                    <span className="ui-win__crumb">Approvals <i>/</i> <b>All {waiting}</b></span>
                    <span className="ui-spacer" />
                  </div>
                  <div className="ui-win__body">
                    <div className="ui-win__main">
                      <div className="ui-win__cols" aria-hidden="true"><span>Company</span><span>Decision</span><span>Status</span><span>Age</span></div>
                      <ul className="ui-win__rows">
                        {queue.map((d, i) => (
                          <li key={d.id} className="ui-win__row" data-row><span className="ui-avatar" data-tone={(i % 5) + 1}>{initials(d.title)}</span><span className="ui-win__who">{d.title}</span><span className="ui-win__sub">{d.label}</span><span className={`ui-win__st${d.kind === "exception" ? " is-you" : ""}`} data-st>{d.kind === "exception" ? "Needs you" : "Open"}</span><span className="ui-win__age">{ago(d.createdAt, now)}</span></li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              <div className="app__pane app__pane--open">
                <div className="ui ui-doc" data-ui="doc">
                  <article className="ui-doc__page">
                    <div className="ui-doc__label">{first ? first.label : "Nothing open"}</div>
                    <div className="ui-doc__title">{first ? first.title : "The queue is clear"}</div>
                    <div className="ui-doc__text">{first?.description ? <mark className="ui-doc__mark is-on">{first.description}</mark> : "New exceptions and emails to approve land here."}</div>
                    {queue.slice(1, 5).map((d) => <div key={d.id} className="ui-doc__text"><b>{d.title}</b>: {d.description ?? d.label}</div>)}
                  </article>
                  <aside className="ui-doc__note ui-panel is-on" aria-live="polite">
                    <div className="ui-doc__kind"><span className="ui-doc__dot" /><span data-doc-kind>{first?.kind === "approval" ? "Approval" : "Exception"}</span></div>
                    <div className="ui-doc__msg" data-doc-msg>{first ? `${first.label} Opened ${ago(first.createdAt, now)} ago.` : "Nothing waits for a person."}</div>
                    <div className="ui-doc__where" data-doc-where>Oldest first</div>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="flow" aria-labelledby="flow-h">
          <div className="wrap">
            <div className="grid">
              <div className="span-5 stack-4">
                <h2 id="flow-h">Accounts in the company flow</h2>
                <p className="t-lead">{n[0]} companies came in and {n[3] ?? 0} reached {lower(step(3))}.{gap > 0 ? ` The biggest gap is ${lower(step(gap - 1))} to ${lower(step(gap))}: ${stuck} wait there.` : ""}</p>
                <p className="fl-fact">{step(1)}: {n[1] ?? 0} of {n[0]}</p>
                <p className="fl-fact">{step(2)}: {n[2] ?? 0}</p>
                <p className="fl-fact">{step(n.length - 1)}: {n[n.length - 1] ?? 0}</p>
                <a className="link" href="/pipeline">Open the pipeline</a>
              </div>
              <div className="frame frame--split frame--lit span-6 start-7">
                <div className="stage stage--fade-br">
                  <div className="at-rise fit" style={{ ["--fit-max" as string]: "420px", ["--ax" as string]: "max(24px, 50% - 210px)", ["--ay" as string]: "40px" }}>
                    <div className="ui ui-panel ui-pipe" data-ui="pipeline-board">
                      <div className="ui-pipe__head">
                        <span className="ui-pipe__repo">{p.name}</span><i className="ui-pipe__slash">/</i><code className="ui-pipe__ref">company flow</code>
                        <span className="ui-spacer" />
                        <span className="ui-chip ui-chip--ink ui-pipe__chip" data-pipe-chip data-done="Counted">Live</span>
                      </div>
                      <ol className="ui-pipe__steps">
                        {flowShown.map((s, i) => (
                          <li key={s.key} className={`ui-pipe__step${i < runAt ? " is-done" : i === runAt ? " is-run" : ""}`} data-step={s.key} style={i === runAt ? ({ ["--k" as string]: String(Math.max(0.05, rate / 100)) }) : undefined}>
                            <span className="ui-pipe__ico"><Check /></span>
                            <span className="ui-pipe__name"><span className="ui-pipe__nm">{s.label}</span></span>
                            <code className="ui-pipe__cmd">{i ? `${n[i - 1] ? Math.round((n[i] / n[i - 1]) * 100) : 0}% of ${lower(step(i - 1))}` : "entry point"}</code>
                            <span className="ui-pipe__time">{n[i]}</span>
                            <span className="ui-pipe__bar"><i /></span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section ground-surface" id="signals" aria-labelledby="signals-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="signals-h">Account signals this week. <span className="muted">What needs a person, and what came in.</span></h2>
            </div>
            <div className="grid">
              <article className="card card--row card--open span-6">
                <h3>Lists accounts that need a person</h3>
                <p>Overdue hand-offs, paused outreach and replies nobody answered, with the company and the reason.</p>
                <div className="panel">
                  <div className="stage stage--fade-b">
                    <div className="at-rise fit" style={{ ["--fit-max" as string]: "400px", ["--ax" as string]: "max(24px, 50% - 200px)", ["--ay" as string]: "calc(100% - 220px)", ["--ay-sm" as string]: "24px" }}>
                      <div className="ui ui-notify" data-ui="notify">
                        <ul className="ui-notify__list" data-notify-list>
                          {(signals.length ? signals : [{ kind: "All clear", title: "Nothing is stuck", detail: "No overdue, paused or failed work", at: now }]).map((a, i) => (
                            <li key={i} className="ui-note"><span className="ui-avatar ui-note__av" data-tone={(i % 5) + 1}>{initials(a.title)}</span><span className="ui-note__text"><span className="ui-note__title">{a.title}<time>{ago(a.at, now)}</time></span><span className="ui-note__body">{a.kind} · {a.detail}</span></span></li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
              <article className="card card--row card--open span-6">
                <h3>Counts new accounts each day</h3>
                <p>{importedWeek} companies came in over the last seven days, counted on the day each was added.</p>
                <div className="panel">
                  <div className="stage stage--fade-b">
                    <div className="at-rise fit to-edge" style={{ ["--fit-max" as string]: "420px", ["--ax" as string]: "max(24px, 50% - 210px)", ["--ay" as string]: "40px", ["--ay-sm" as string]: "24px" }}>
                      <div className="ui ui-panel ui-stat" data-ui="stat" data-from={String(importedWeek)} data-to={String(importedWeek)} data-values={days.join(",")}>
                        <div className="ui-stat__head">
                          <div className="ui-stat__top"><span className="ui-stat__label">Companies added</span><span className="ui-stat__range">Last 7 days</span></div>
                          <div className="ui-stat__line"><span className="ui-stat__num" data-stat-num>{importedWeek}</span><span className="ui-stat__sub">busiest day {days.indexOf(topDay) >= 0 ? dayLabel(days.indexOf(topDay)) : "none"}</span></div>
                        </div>
                        <div className="ui-stat__chart">
                          <svg className="ui-stat__svg" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">
                            <path className="ui-stat__grid" d="M0 30.5H400M0 60.5H400M0 90.5H400" />
                            <path className="ui-stat__cover" fillRule="evenodd" d="" />
                            <g className="ui-stat__bars">{days.map((v, i) => { const h = Math.max(2, (v / topDay) * 104); return <rect key={i} rx="3" x={(i * 400) / 7} y={120 - h} width={400 / 7 - 8} height={h} />; })}</g>
                          </svg>
                          <div className="ui-stat__axis" aria-hidden="true"><span>{dayLabel(0)}</span><span>{dayLabel(3)}</span><span>Today</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="section statement" id="week" data-moment="word-highlight" aria-label="This week">
          <div className="wrap">
            <p className="t-label">This week</p>
            <p className="mo-wh__text">This week {importedWeek} companies came in. {n[1] ?? 0} passed the fit rules, {n[2] ?? 0} were researched{gap > 0 ? `, and ${stuck} ${lower(step(gap - 1))} companies still wait for ` : " and the rest wait for "}<strong>{gap > 0 ? lower(step(gap)) : "the next step"}</strong>.</p>
          </div>
        </section>
      </main>

      <footer className="footer closing g2m" id="contact" aria-labelledby="close-h">
        <div className="wrap">
          <div className="closing__cta close--word">
            <div className="section-head--split">
              <div><h2 id="close-h">Today&apos;s decisions, oldest first</h2><p className="t-lead">{plural(waiting, "decision is", "decisions are")} open for {p.name}.</p></div>
              <a className="btn btn--primary" href="/review">{MAIN}<Arrow /></a>
            </div>
            <p className="close__word" aria-hidden="true">ABM Intelligence</p>
          </div>
          <div className="closing__links">
            <div className="grid">
              <div className="span-4 stack-4">
                <a className="nav__logo" href="#top"><span className="mark" data-mark="dots" aria-hidden="true" />ABM</a>
                <p className="footer__lede">Account intelligence for B2B sales teams.</p>
              </div>
              <div className="span-2 footer__col"><h3>Accounts</h3><ul><li><a href="/accounts">Companies</a></li><li><a href="/people">People</a></li></ul></div>
              <div className="span-2 footer__col"><h3>Prospect</h3><ul><li><a href="/import">Import</a></li><li><a href="/discover">Discover</a></li></ul></div>
              <div className="span-2 footer__col"><h3>Engage</h3><ul><li><a href="/work/today">Today</a></li><li><a href="/outreach">Emails</a></li></ul></div>
              <div className="span-2 footer__col"><h3>Pipeline</h3><ul><li><a href="/handoffs">Hand-offs</a></li><li><a href="/overview">Insights</a></li></ul></div>
            </div>
            <div className="footer__legal">
              <span>&copy; {now.getFullYear()} ABM Intelligence</span>
              <div className="socials" />
            </div>
          </div>
        </div>
      </footer>
      <nav className="actionbar" aria-label="Quick actions">
        <a className="btn btn--primary" href="/review">{MAIN}</a>
      </nav>
    </HomeDoc>,
  );
}
