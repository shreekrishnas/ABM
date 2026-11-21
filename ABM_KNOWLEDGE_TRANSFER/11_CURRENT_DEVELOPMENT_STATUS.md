# 11 · Current development status (as of 21 Nov 2026)

## Build health [Runtime, this engagement]
- The latest production deployment on Vercel is **READY**. It was built from the working branch at the commit that renamed the assistant to Vega.
- Locally on that code:
  - `tsc` passes;
  - the token lint passes;
  - **522/522 unit tests pass**;
  - `next build` passes.
- The 8 e2e journeys passed on the previous commit but weren't re-run for the rename.
- CI: `.github/workflows/checks.yml` runs tsc, tokens, a Postgres 17 database push, vitest, the build and Playwright, all with mock adapters.

## Working (verified)
- Deployments, sign-in, and the Super Admin team page with its People and Audit tabs.
- Companies and company pages, approvals, insights, and the Vega page opening (e2e).
- AI pause and budgets (they act on live data).

## Implemented, not verified live
- The research pipeline (idle because AI is paused).
- Vega Levels 1–3 in production (needs Vega turned on for a client and the tick "agent" step running).
- SMTP sending, the reply webhook, and LinkedIn tracking.
- Knowledge base, Brain editor, discovery and lookalikes.

## Broken or blocked live
1. **The daily tick chain stops after "core"** (R1 in 10).
2. **AI is paused** (a deliberate admin action on 20 Nov), so about 410 companies are queued.
3. **Website visitors are empty:** data was cleared on 15 Nov. The daily pull is fixed in code; someone must press "Fetch website visitors" or wait for the next daily run. [Verify after the next run]

## Partial
- LinkedIn is manual. The CRM is internal only. Vega is Super Admin only. There's no intent provider.

## Unused or possibly abandoned
- `/kit` and most of `components/kit`.
- `peek/approval-keys.tsx` [Verify].
- Several `@fontsource` packages.
- the root-level `*_AI_RESEARCH_BRAIN_AUDIT.md` (out of date).

## Pending decisions
- **The P0-1 contract migration** has been written but is not applied, and needs explicit owner approval.
- **The remaining Vega roadmap** is paused at the owner's request: always-on schedule, team access, plays, decision cards, WhatsApp/Slack, mailbox/CRM sync, job-change detection, voice.
- **The fix for the tick chain** has been offered but not started.

## Recent changes (latest first)
1. Assistant renamed JARVIS → Vega, and Vega now follows the active client.
2. Super Admin People redesign.
3. Apollo daily pull runs inside the owning client and reports errors.
4. Visitors need 2+ signals before approval, plus the audit-filter fix.
5. Vega chat acts after Confirm.
6. Vega Levels 1–3 and the Home core.
