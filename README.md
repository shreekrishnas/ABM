# ABM Intelligence

Account-based marketing platform: a 13-stage intelligence pipeline, an ABM dashboard
and a built-in CRM in one Next.js app on PostgreSQL.

- **Pipeline:** raw accounts → clean → fit/tier/exclusions → identity → research plan →
  research → evidence twin → buying group → enrichment → readiness gate → draft & review →
  multi-channel sequences → sales handoff. Every gate decision is logged with a reason.
- **Dashboard:** buying-stage funnel, tiers, engagement trend, gate blocks, hottest accounts,
  review queue, analytics (reply rate by angle, results by tier, spend by stage).
- **CRM:** accounts, contacts, opportunities (kanban), tasks, notes, GDPR erasure.

External services (data provider, research, LLM, mailbox verification, email, intent)
are behind adapter interfaces with deterministic mocks, so everything runs today and real
APIs plug in later. See [`docs/PLAN.md`](docs/PLAN.md) for the plan, decisions and risk register.

## Quick start

```bash
# 1. PostgreSQL 16 running locally, then:
createuser -s abm  # or use your own role
createdb -O abm abm && createdb -O abm abm_test
cp .env.example .env            # adjust DATABASE_URL if needed

# 2. Install, migrate, seed (seed runs real data through the real pipeline)
npm install
npx prisma migrate deploy
npm run db:seed

# 3. Run
npm run dev                     # http://localhost:3000
npm test                        # unit + integration tests (uses abm_test)
npm run pipeline:run            # one scheduler tick from the command line (or pass account ids)
npm run build                   # production build
```

## Project layout

```
prisma/schema.prisma        Data model (CRM + pipeline + engagement + ops)
prisma/seed.ts              Seeds a realistic workspace through the pipeline
src/lib/config.ts           Every threshold (ICP, budgets, freshness, scoring, caps)
src/lib/pipeline/
  gates.ts, scoring.ts      Pure decision functions (unit tested)
  normalize.ts              Domain/title/email/phone normalization
  stages/                   data (2–4) · research (5–7) · people (8–9) · outreach (10–11) · engagement (12–13)
  orchestrator.ts           runAccount, runBatch, watchlist, intent surge, tick (scheduler)
  context.ts                Event log, cost ledger with budget cap, review queue, watchlist
  ingest.ts                 Stage 1: CSV/API/form input with loose header mapping
  gdpr.ts                   Right to erasure with hashed suppression
src/lib/adapters/           Interfaces + mock implementations
src/app/                    Pages (dashboard, accounts, pipeline, review, outreach, signals, handoffs, crm/*, analytics, import, settings)
src/app/actions.ts          Server actions (zod-validated)
src/app/api/v1/             REST API
docs/                       PLAN.md, DESIGN-reference.md, pipeline-v1.html (original flow)
```

## Weekly CSV imports

`/import` accepts a CSV built from the predefined template (download it on the page;
columns are defined in `src/lib/import/fields.ts`). Upload as often as you like:

- Companies match on **Domain**; people match on **Email**, then name within the company.
- Newer non-blank values update the record; blank cells never erase data.
- Only changed fields lose their verified status and are re-checked.
- Columns outside the template are ignored and listed; invalid rows are rejected with row number and reason.
- New and changed accounts are queued and run through the pipeline automatically, in small
  batches (no file-size or timeout limit). Unchanged accounts are skipped — no repeat spend.
- GDPR-erased people are never re-imported.

## Knowledge base

Settings → Knowledge base: outreach research, the writing playbook, personas, objection answers,
example messages and Manch's material, chunked and embedded (OpenRouter embeddings). Each draft
retrieves what fits the person and step; emails that get positive replies are learned as examples.
See [`docs/KNOWLEDGE.md`](docs/KNOWLEDGE.md).

## Background queue

Imports, "Queue new accounts" and the daily run mark companies `queued`. `POST /api/v1/queue`
answers at once, then works through the queue for one 45-second slice after responding and
calls itself again until the queue is empty, so a large import finishes after the page is
closed. A database lease (`JobLease`) lets only one chain run at a time; a crashed one expires
and the next kick (or the daily run) takes over. The Import and Behind-the-scenes pages show
what is waiting, with a "Process now" button. No external service is needed.

Set `APP_URL` if the deployment can't call its own URL (e.g. password-protected previews).

## REST API (`/api/v1`)

Every route except `/health` needs `Authorization: Bearer <ABM_API_KEY>`. In production the API
fails closed: with no key set, routes answer 503 (set `ABM_API_OPEN=true` only for a private test
deployment). `/tick` also accepts `CRON_SECRET`, which Vercel Cron sends on its daily call.
Settings → Access & spend shows what is configured.

| Method | Path | Purpose |
|---|---|---|
| GET | `/accounts?stage=&limit=` | List accounts |
| POST | `/accounts` | `{ rows: IngestRow[], run?: boolean }` import and optionally run |
| GET | `/accounts/:id` | Account with contacts, field states, latest twin, opportunities |
| GET | `/contacts?accountId=` | List contacts |
| POST | `/import` | Raw `text/csv` body (same template rules; then call `/tick` to process) |
| GET | `/health` | Public: database connected yes/no |
| POST | `/pipeline/run` | `{ accountIds, fromStage? }` |
| POST | `/signals` | Tracking/intent/email webhook — `{ domain \| accountId, type, contactEmail?, detail? }` |
| POST | `/replies` | Inbox webhook — `{ fromEmail, body }` → classified and routed |
| POST | `/tick` | Cron: advance sequences, send approved, watchlist, intent, escalations |
| GET / POST | `/queue` | Queue status / start the background drain (also accepts `CRON_SECRET`) |
| POST | `/gdpr/erase` | `{ email }` erase and suppress |

## Design

Glassmorphism system from `docs/DESIGN-reference.md` — same tokens, radii, atmosphere,
glass shell, icon rail, pills and cards — upgraded with Geist Sans/Mono (Inter's successor
in feel), Fraunces variable with optical sizing for KPI figures, lucide icons (stroke 2),
validated colour-blind-safe chart palette, global toasts and reduced-motion support.
Light and dark themes flip via `data-theme` on `<html>`.

## Going live (roadmap)

1. Auth and roles, multi-workspace, `ABM_API_KEY`.
2. Real adapters, switched on per service by env var. Live now: web research (`EXA_API_KEY`,
   `TAVILY_API_KEY`, `SERPAPI_API_KEY`) and the LLM via OpenRouter (`OPENROUTER_API_KEY`,
   `LLM_MODEL`, default `openai/gpt-4o-mini`). Still mock: contact provider (Apollo), mailbox
   check, sending, intent, alerts. `ADAPTER_MODE=mock` forces everything back to mocks.
3. ~~Background queue~~ done (self-chaining `/api/v1/queue`). Move to Inngest if runs need retries or fan-out.
4. Website tracking script for reverse-IP visits.
5. ~~Editable seller profile~~ done (Settings → Seller profile → Edit, with version history). Pipeline thresholds in `config.ts` are still code.
