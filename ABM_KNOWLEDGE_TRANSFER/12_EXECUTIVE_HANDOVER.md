# 12 · Executive handover

## In one paragraph
ABM Intelligence is a multi-client ABM workbench built with Next.js 16, Prisma, Postgres and Vercel. It finds target companies, researches them with sourced and confidence-scored facts, finds the buying group, and drafts emails that a person approves before anything is sent. It then tracks replies and hands warm accounts to sales. An assistant, Vega, answers questions, does safe in-app work, reacts to events, and recommends approvals. Nothing goes out without a person confirming it. The codebase is modular (about 42k lines) and well tested (522 unit tests and 8 e2e journeys in CI). Production is deployed and healthy at the build level, but **the automation is currently idle**: AI is paused, the daily chain only runs its first step, and the visitor data was cleared.

## Start here (for a new developer)
1. Read `AGENTS.md`. This Next.js version differs from what you may know; read `node_modules/next/dist/docs/` first.
2. Read the files in this order:
   - `src/proxy.ts` → `src/lib/auth.ts` → `src/lib/scope.ts` and `src/lib/db.ts` (tenancy)
   - `src/lib/pipeline/orchestrator.ts` → `src/lib/pipeline/stages/*`
   - `src/lib/adapters/index.ts` → `src/lib/adapters/live/*`
   - `src/lib/agent/*` (Vega)
   - `src/app/layout.tsx`, `src/components/shell/Shell.tsx`, `src/lib/nav.ts`
3. **Run locally:** Postgres plus `ADAPTER_MODE=mock`.
4. **Checks:** `npx tsc --noEmit -p .`, `npm run lint:tokens`, `npx vitest run`, `npm run build`, `npm run test:e2e`.

## Top priorities
| Priority | Action | Why |
|---|---|---|
| 1 | Fix the daily tick self-chain (R1) | Without it, intel, intent, market signals and Vega's loop never run in production |
| 2 | Limit workspace-key routes to one client (S1); require `WEBHOOK_SECRET` and `AUTH_SECRET` in production (S2, S3) | Tenant isolation |
| 3 | Add the registered postal address to the seller profile (R4) | Legal requirement before sending email |
| 4 | Resume AI and re-fetch website visitors (an owner decision) | The queue holds about 410 companies |
| 5 | Make "clear client data" safer (soft delete or confirmation with a count) | It caused the 15 Nov loss |
| 6 | Extend prompt fencing to every untrusted input; add live-model smoke tests and axe accessibility checks | AI safety and quality |
| 7 | Merge the two token and component systems | UI debt |
| 8 | Decide on the P0-1 contract migration | Pending owner approval |

## Areas this engagement could not inspect
- **Live environment variables** (the Vercel environment API returned 403), so the production model choices, SMTP, webhook secret and Apollo setup are unconfirmed.
- **Real third-party API behaviour and dashboards:** no external calls were made.
- **Production data**, beyond the earlier read-only queries.
- **Full visual QA** of every page at every breakpoint, and screen-reader testing.
- **Load and performance** under realistic volume.

## Redaction note
- Client names, people, emails, project and team IDs, hostnames and keys are removed or replaced with roles.
- File paths that contain a client name are shown as `src/lib/seller/<built-in seller>.ts`.
