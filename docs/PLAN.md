# ABM Intelligence Platform: Build Plan

This document is the plan written before any code. It records what is being built,
the decisions behind it, the problems those decisions could cause, and how each one
is handled up front.

## 1. What we are building

One application with three jobs:

1. **ABM pipeline.** Takes raw accounts to verified, evidence-based outreach and a
   sales handoff (13 stages, every gate logged).
2. **ABM dashboard.** Shows accounts moving through buying stages, where the
   pipeline is blocked, what needs a human, and what it is producing (pipeline,
   replies, cost).
3. **Built-in CRM.** Accounts, contacts, opportunities, tasks, notes and activity.
   It is the system of record. There is no external CRM to sync with.

## 2. Stack

| Layer      | Choice                                   | Why |
| ---------- | ---------------------------------------- | --- |
| App        | Next.js 16 (App Router) + React 19 + TS  | One codebase for UI, server actions and REST API |
| Styling    | Tailwind v4 + CSS tokens from `DESIGN.md`| Glass design system with light and dark themes driven by variables |
| Database   | PostgreSQL 16 + Prisma 6                 | Relational CRM data, JSON for twin snapshots, migrations |
| Charts     | Recharts 3                               | Matches the design system |
| Icons      | lucide-react                             | Outline icons with stroke 2, same as the design spec |
| Validation | zod                                      | Every API input is validated |
| Tests      | vitest                                   | Gates and scoring are pure functions; the pipeline has an integration test |

External services (data provider, research/search, LLM, mailbox verification, email
sending, intent data) sit behind **adapter interfaces** in `src/lib/adapters`.
Today they are deterministic mocks. Real APIs plug in later without touching stages.

## 3. Pipeline (revised order)

The original flow verified identity before checking fit. That pays the data
provider for people at accounts that get excluded one stage later. The fit and
exclusion checks now run first.

| # | Stage | Category |
|---|-------|----------|
| 1 | Data Input | Data |
| 2 | Clean & Normalize | Data |
| 3 | Fit, Tier & Exclusions | Data |
| 4 | Identity Verification | Data |
| 5 | Research Plan | Research |
| 6 | Account Research | Research |
| 7 | Evidence & Account Twin | Research |
| 8 | Buying Group Discovery | People |
| 9 | Contact Enrichment | People |
| 10 | Readiness Gate | Outreach |
| 11 | Draft & Review | Outreach |
| 12 | Sequence, Send & Measure | Engagement |
| 13 | Sales Handoff & Recycle | Engagement |

**Continuous (outside the linear flow):** signals (intent, anonymous website
visits, job changes, engagement) update the **account-level** score and buying
stage. A spike in intent can pull a watched account back into research.

### Buying stages (account level)
`UNAWARE → AWARE → ENGAGED → MQA → OPPORTUNITY → CUSTOMER`, plus `WATCH`,
`DISQUALIFIED` and `RECYCLED`.

### Tiers
| Tier | Motion | Budget / account | Draft approval |
|------|--------|------------------|----------------|
| T1 | 1:1 | $5.00 | Always human |
| T2 | 1:few | $2.00 | Always human |
| T3 | 1:many | $0.75 | Human by default (configurable) |

## 4. Fixes carried over from the review

| Problem in v1 flow | Fix |
|---|---|
| Identity checked before fit | Fit and exclusions run first (stage 3) |
| Missing firmographic data scored as zero fit | Fit is scored on known fields only; coverage feeds data confidence |
| Research priority ignored data confidence; no "low" | Priority = f(fit, confidence, intent); high, medium or low |
| Engagement scored per person | Account-level score across the buying group, including anonymous visits |
| Engagement from uncontacted people discarded | Still kept out of person-level handoff, but counted in the account score |
| Opens weighted 10 (Apple MPP makes them noise) | Open = 2 |
| Only customer and competitor exclusions | Also partners, open opportunities, lost < 90 days, rep-owned do-not-contact |
| One email, no sequence | Multi-step, multi-channel sequences (email auto; LinkedIn and calls create rep tasks) |
| Same budget and approval for every account | Tiers set budget and approval policy |
| No GDPR | EU/EEA basis = legitimate interest with an LIA reference; erasure endpoint |
| Lost deals had no path back | Closed-lost goes to the watchlist for 90 days, then `RECYCLED` |
| "Wrong person" reply re-maps only | Also asks for a referral (task) |
| Unclear reply defaulted to objection | `needs_human` class |
| Daily cap ambiguous | Per mailbox (40) plus a global cap |
| Weights retune only at 200 closed deals | Leading indicators (reply rate by angle/trigger) visible from day one |

## 5. Risks and how they are handled up front

| Risk | Consequence if ignored | Mitigation built now |
|---|---|---|
| Pipeline runs twice on the same account | Duplicate sends, double charges | Every stage is idempotent; sends keyed by draft id (`Message.draftId` unique); stage cursor stored on the account |
| A stage crashes halfway | Account stuck in an unknown state | Each stage runs in a DB transaction; failures write a `PipelineEvent` with `outcome=error` and stay re-runnable |
| Budget overrun from the LLM or lookups | Surprise costs | Every paid call goes through `ledger.charge()`, which checks the tier budget first and refuses past the cap |
| Silent drops | Lost accounts, nobody knows why | Gates must return `{pass, reason}`; any block writes a `PipelineEvent` and a `ReviewItem` / `WatchlistEntry` / `Suppression` |
| Hallucinated claims in drafts | Brand and legal damage | Fact guardrail: every claim cites a usable fact id; failures regenerate up to 3 times, then human review |
| Sending to suppressed or opted-out people | Legal exposure | Suppression checked at enrichment AND immediately before send |
| Deliverability collapse | Domain blacklisted | Bounce breaker (2 % pauses everything) and per-mailbox caps |
| Mock data leaking into production | Fake facts in real emails | Adapters selected by `ADAPTER_MODE`; `mock` mode marks evidence `sourceType=mock`, and the readiness gate refuses mock evidence when `ADAPTER_MODE=live` |
| Schema churn once real APIs land | Painful migrations | Prisma migrations from day one; external payloads kept in JSON `raw` columns |
| No auth yet | Anyone can reach the API | Single-tenant dev only; every table carries `workspaceId`-ready structure; auth (NextAuth / Clerk) is roadmap item 1 before deploy |
| Merged records lose history | Broken references | Duplicates marked `mergedIntoId`, never deleted |
| GDPR erasure vs. audit log | Conflict between deleting and proving | Erasure deletes PII and keeps a hashed suppression row so the person is never re-imported |

## 6. Folder layout

```
prisma/            schema.prisma, migrations, seed.ts
src/app/           pages (dashboard, accounts, pipeline, review, outreach, signals, handoffs, crm/*, analytics, settings, import)
src/app/api/       REST endpoints (accounts, contacts, pipeline/run, drafts, signals, import, gdpr/erase)
src/components/    shell (sidebar/topbar), ui (cards, badges, tables, charts)
src/lib/config.ts  every threshold (the old pipeline.yaml)
src/lib/pipeline/  stages, gates (pure), scoring (pure), orchestrator, ledger, events
src/lib/adapters/  interfaces + mock implementations
tests/             vitest unit and integration tests
```

## 7. Roadmap after this build

1. Auth and roles (admin, marketer, rep, reviewer) plus multi-workspace.
2. Real adapters: Apollo/Clearbit (provider), Bombora/G2 (intent), Exa/Serper (research), Claude (LLM), ZeroBounce (mailbox), SES/Postmark or Gmail API (send).
3. Background job queue (Inngest or BullMQ) to replace synchronous runs.
4. Website tracking script for reverse-IP visits.
5. Editable settings stored in the DB, with audit history.
