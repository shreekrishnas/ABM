# 10 · Technical debt and risks

## Security
| # | Finding | Evidence | Severity |
|---|---|---|---|
| S1 | `api/v1/accounts/[id]`, `contacts`, `pipeline/run` and `gdpr/erase` accept only the workspace key, and the DB scope is null for API calls, so **these routes are not limited to one client** | `src/lib/api.ts`, `scope.ts` [Code] | High if the workspace key is shared with any client |
| S2 | The webhook HMAC check is skipped when `WEBHOOK_SECRET` is unset | `src/lib/webhook-signature.ts` [Code]; production value unknown [Verify] | Medium |
| S3 | The session-signing secret falls back to `CRON_SECRET` | `src/lib/auth.ts` [Code] | Medium |
| S4 | The rate limiter fails open on a database error | `src/lib/rate-limit.ts` [Code] | Low–Medium |
| S5 | The tracking endpoint accepts any origin outside production when its allowlist is empty | `api/v1/track` [Code] | Low |
| S6 | Prompt-injection fencing is used at only about 3 call sites | `src/lib/llm/fence.ts` [Code] | Medium; [Verify] coverage |
| S7 | A destructive seed endpoint exists (guarded by a key and `ALLOW_SEED`) | `api/v1/admin/seed` [Code] | Low while `ALLOW_SEED` stays off |
| S8 | "Clear client data" deletes without a soft delete or backup prompt | `src/app/team/actions.ts` [Code]; caused data loss [Runtime] | Medium (operational) |

Positives:
- All raw SQL is parameterised; `$queryRawUnsafe` is not used.
- `dangerouslySetInnerHTML` appears only for the static theme script.
- Keys are encrypted at rest.
- Per-client API keys are stored as hashes.

## Reliability
- **R1:** the daily tick self-chain stops after "core" on live, so intel, intent, market and Vega-loop never run [Runtime]. Likely causes [Assumption]:
  - the self-POST target or auth fails on Vercel (`APP_URL`, deployment protection, `selfToken`);
  - `after()` is cut short.
- **R2:** Vercel's plan allows only a once-a-day cron, so near-real-time work depends on the drain self-chaining and the watchdog that runs on page use.
- **R3:** there's no external error tracker or APM, so observability is limited to in-app `ErrorLog` and `RunLog` rows.
- **R4:** there's a compliance blocker. The registered postal address required in every email is still a TODO in the built-in seller file (`src/lib/seller/…:179`).

## Maintainability
- The large files are `src/app/actions.ts` (912 lines) and `src/lib/adapters/mock.ts` (849). The rest of the code (about 42k lines) is modular.
- There's duplicate UI (kit vs `ui.tsx`/`v2.tsx`) and duplicate token files (see 09).
- the root-level `*_AI_RESEARCH_BRAIN_AUDIT.md` is out of date (it says one cheap model is used everywhere), and `docs/PLAN.md` predates the code.
- There's only one TODO in `src`, so the code is clean of markers.

## Testing gaps
- No live-model regression tests in CI; `npm run bench` is manual.
- E2E tests mostly check that pages open, on desktop Chromium only, with no mobile or accessibility runs.
- There are no React component tests.
- The tracking endpoints and real SMTP sending are not tested.

## Scalability [Assumption]
- The single-region Postgres plus serverless functions with 45-second queue slices handle low-hundreds of accounts per day per client.
- Large backfills depend on the drain chain staying alive.
- `resolveScope` and integration keys use short in-memory caches, so behaviour per serverless instance can differ briefly.
