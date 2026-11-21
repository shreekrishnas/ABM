# 07 · Feature inventory

**Status key:**
- **W**: working; verified at runtime or by e2e during this engagement.
- **I**: implemented and unit-tested, but not verified live.
- **P**: partial.
- **B**: broken or failing live.
- **N**: not built or planned.
- **U**: present but unused.

| Feature | Where | Status | Notes |
|---|---|---|---|
| Sign-in with magic link, sessions, sign out everywhere | `src/lib/auth.ts`, `/login` | I | Live sign-in is in use [Runtime: sign-in events exist] |
| Multi-client tenancy and scoped DB | `src/lib/db.ts`, `scope.ts` | I | Many tests (`client-scope`, `tenant-identity`) |
| Roles: owner, manager, rep, viewer | `src/lib/roles.ts` | I | |
| Super Admin team, audit log and People page | `/team` | W | Redesigned and deployed [Runtime] |
| Integration key vault | `/admin/integrations` | I | |
| Companies list, filters, saved views, bulk actions, export | `/accounts` | W | e2e journey 1 |
| Company page: research card with sources and confidence | `/accounts/[id]` | W | e2e journey 1 |
| People and buying-group board | `/people` | I | |
| CSV/XLSX import wizard | `/import/upload` | I | |
| Describe companies (AI discovery) | `/import/describe` | I | Opens in e2e journey 3; needs live LLM and search keys |
| Lookalikes | `/import/lookalikes` | I | Extra page |
| Website visitors (Apollo) with the 2+ signals rule | `/import/apollo` | P | Code fixed and deployed; **live data was cleared on 15 Nov and hasn't been re-fetched since** [Runtime] |
| Market signals and daily "Recommended today" | `/discover` | I | Skipped while AI is paused |
| Careers-board hiring signals | `src/lib/signals/jobs.ts` | I | |
| 13-stage research pipeline | `src/lib/pipeline` | I | **Idle live: AI paused, about 410 companies queued** [Runtime] |
| Approvals with critics and "Why this email" | `/review` | W | e2e journey 5 |
| SMTP sending of approved emails | `live/email.ts` | I | [Verify] SMTP configured in production; postal-address TODO |
| Reply webhook, classification, hand-off | `api/v1/replies`, stage 12–13 | I | |
| LinkedIn notes | `src/lib/linkedin` | P | Manual copy and send |
| Tasks, deals, hand-offs | `/crm/*`, `/handoffs` | I | |
| Insights and Overview | `/analytics`, `/overview` | W | e2e journey 6 |
| Notifications feed | `src/lib/notifications.ts` | I | |
| Background jobs and top-bar indicator | `src/lib/jobs` | I | |
| Daily tick chain (core → agent) | `api/v1/tick` | **B** | Only "core" logs live [Runtime] |
| Monthly budgets and AI pause | `budget.ts`, `ai-pause.ts` | W | AI pause is active live [Runtime] |
| Knowledge base (RAG) | `/settings/knowledge` | I | |
| Account Brain editor | `/brain` | I | |
| Vega Level 0–3, Home core, chat with Confirm | `src/lib/agent`, `/vega` | I | Super Admin only; e2e journey 8 checks only that it opens |
| Super Admin assistant | `src/lib/assistant` | I | |
| Command palette, quick task, keyboard shortcuts | `src/components/shell` | I | |
| Component kit demo | `/kit` | U | Not linked |
| Kit DataTable, FilterBar, DecisionCard, FormField | `src/components/kit` | U | Used only by `/kit` [Assumption] |
| Third-party intent data | — | N | `NoIntent` |
| Slack/Teams alerts | — | N | "planned" |
| External CRM sync | — | N | |
| Vega: always-on schedule, team access, plays, WhatsApp, voice | — | N | Roadmap |
| P0-1 contract migration | prisma | N | Awaiting owner approval |
