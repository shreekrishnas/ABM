# The AI brain

One model (OpenRouter, default `openai/gpt-4o-mini`) runs the whole flow for the client (Manch).
Every step hands the next one structured, validated output; nothing about a prospect is ever
taken from the model without a source.

| Step | Stage | What the brain does | What code enforces |
|---|---|---|---|
| Plan | 5 | Picks the questions that matter for this company, writes a company-specific query, chooses the engine, states hypotheses | High-importance questions can't be dropped; engine must exist; query must name the company; learned routing wins once an engine has 10+ searches |
| Search once | 6 | — | One engine per question, next engine only if the first fails or finds nothing; a question searched in the last 7 days is served from cache; every engine call is logged and charged |
| Extract | 6 | Pulls facts from pages and spots when a page reports a fact we already hold | URL and date come from the page; evidence gate; same-source dedupe |
| Verify | 10 → 6 | Second source only for a single-source trigger, with a claim-specific query on a different engine | One follow-up per account; corroboration groups the two sources so the fact becomes verified |
| Connect | 7 | Account brief: verdict, why now, pain points → Manch use case, angle per buying role, hypotheses, risks, next action | Pain points citing unknown facts or unknown use cases are dropped |
| Angle per person | 11 | — | Each person starts from their role's angle; colleagues get unused pain points first |
| Write + check | 11 | Writes the email around the angle; a second pass checks each claim against its cited fact | Fact guardrail + claim check, regenerate up to 3×, then a person; if the checker is down, a person reviews even T3 |
| Learn | weekly | Summarises what works / doesn't from the numbers | No conclusion from fewer than 10 examples; research routing applied automatically; messaging learnings go to the writer as style advice; ICP changes wait for a person |

If the model fails at plan, brief or insight time, a rule-based brain takes over and the run
continues; the fallback is recorded (`planner`/`model` = `rules`).

## Accuracy

The AI Brain page tracks three accuracy numbers against a 98% target:

- **Claims supported** — share of email claims the checker confirmed against their source.
- **Approved as written** — share of reviewed drafts approved without edits.
- **Fact precision** — share of facts not marked wrong. Marking a fact wrong (company page →
  flag icon) removes it at once, withdraws unsent drafts that cite it, and counts against the
  engine that found it.

## Cost controls

Approximate per-search costs live in `CONFIG.costsUsd.search`; each tier has a budget per
account (`CONFIG.budgetsUsd`). A search only starts if the most expensive engine still fits in
the budget. Sample data always runs on mocks and never spends credits.
