# 08 · User workflows (only those that exist in code)

## A. Account discovery
```mermaid
flowchart LR
  U[User] --> H[/import hub/]
  H --> UP[Upload CSV] --> ACC[Accounts queued]
  H --> DS[Describe ideal companies → LLM + search → suggestions]
  H --> LK[Lookalikes of a site → suggestions]
  H --> WV[Website visitors (Apollo) → 2+ signals → suggestions]
  MK[/discover market signals, daily/] --> SG
  DS & LK & WV --> SG[ProspectSuggestion] -->|approve| ACC
```
- Suggestions always need a person's approval before they become accounts.
- Visitors with fewer than two buying signals stay listed as visitors and are not sent for approval (`src/lib/discover/visitors.ts`).

## B. Account research
Accounts are queued, then the drain runs the orchestrator, stages 2–9:
- Normalisation, then fit and tier (exclusions applied).
- Identity check (stops when the company can't be identified with confidence).
- Research plan, then web search, page reading and LLM extraction into Evidence.
- Account Twin (confidence per field).
- Buying group and contact enrichment (Apollo, approved companies only).

Results appear on `/accounts/[id]`: the research card with sources, "What we know", and the quality card.

## C. Prioritisation
- Fit, tier, intent and readiness scores feed the **Today** queue (`/work/today`, Decision Center), "Recommended today", and Home's strongest-signal panel.
- Vega Level 3 marks the strong drafts.

## D. Outreach and approval
- Stage 11 drafts each email, then a critic panel reviews it, with rewrites if needed.
- A reviewer on `/review` approves, edits or rejects it. Edits teach the drafting rules.
- `sendApproved` (tick) sends the approved email over SMTP.
- Sequences schedule the follow-ups.

## E. Engagement and hand-off
- Reply webhook → classify the reply: interested, question, objection, out-of-office, bounce, opt-out.
- Each class has an automatic follow-up (Vega Level 2 and stage 12–13):
  - **Interested:** hand-off to sales.
  - **Question or objection:** a task for the owner.
  - **Out-of-office:** the follow-up is rescheduled.
  - **Opt-out:** suppressed everywhere.
- Deals are moved on the board at `/crm/opportunities`.

## F. Reporting
- `/analytics`: what's working (reply rates, by tier and by angle).
- `/overview`: programme trends.
- `/pipeline`: what the brain did and why.
- Super Admin: system health, spend, errors and audit (`/team`).

## G. Administration
Super Admin can:
- add a client, assign users and roles, and set the monthly budget;
- enter integration keys;
- pause AI;
- clear a client's data. **This is destructive; it caused the 15 Nov visitor loss** [Runtime].

## H. Assistant
- **Home core:** hover for status, click to open the side panel.
- From the panel, ask Vega a question. Vega replies with facts, and any change appears as a proposal card for the user to confirm or dismiss.
- The full workspace at `/vega` adds autonomy settings, the action log with Undo, and recommended approvals.

**Not present as workflows:** paid-media campaign analysis, ad platforms, CRM sync, multi-channel attribution.
