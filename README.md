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
npm test                        # 36 unit + integration tests (uses abm_test)
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

## REST API (`/api/v1`)

Set `ABM_API_KEY` to require `Authorization: Bearer <key>` (required before deploying).

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
| POST | `/gdpr/erase` | `{ email }` erase and suppress |

## Design

Glassmorphism system from `docs/DESIGN-reference.md` — same tokens, radii, atmosphere,
glass shell, icon rail, pills and cards — upgraded with Geist Sans/Mono (Inter's successor
in feel), Fraunces variable with optical sizing for KPI figures, lucide icons (stroke 2),
validated colour-blind-safe chart palette, global toasts and reduced-motion support.
Light and dark themes flip via `data-theme` on `<html>`.

## Going live (roadmap)

1. Auth and roles, multi-workspace, `ABM_API_KEY`.
2. Real adapters (`ADAPTER_MODE=live`): provider, intent, research, Claude LLM, mailbox, email.
3. Background queue (Inngest/BullMQ) to replace synchronous runs; cron hitting `/api/v1/tick`.
4. Website tracking script for reverse-IP visits.
5. Editable settings in the DB with audit history.
