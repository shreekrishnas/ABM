# Phase 1: Companies, People and sender journeys

How the agreed Phase 1 design ("ABM Dashboard — Import and People Workflow") is implemented.

| Spec section | Where it lives |
|---|---|
| 1–2 One CSV import ("Import Companies & People") | `/import` wizard: Upload → Campaign & sender → Map fields → Preview → Import (`src/components/import-wizard.tsx`) |
| Import-level selections | Campaign and sender are required in the wizard and stored on the import batch; Data Source defaults to "CSV Import" unless a column gives it |
| 3 Company fields | `src/lib/import/fields.ts` (Company group); stored on `Account` (`linkedinUrl`, `city`, `keywords`, `companyNotes` added) |
| 4 People fields | Same file (People group); stored on `Contact` (`department`, `location`, `personNotes` added) |
| Optional LinkedIn activity | Connection Sent, Connection Accepted, Follow-ups Sent, Last Follow-up Date, Last Reply, Last Reply Date, Stage |
| 5 Matching and multi-sender storage | Company: website → company LinkedIn URL → normalized name (not when websites differ). Person: LinkedIn URL → email → full name + company (not when both have different LinkedIn URLs). Journey: unique person + campaign + sender (`Journey` table) |
| 6 People table and detail panel | `/people` (filters: campaign, sender, stage, eligible to call) and `/people/[id]` (sender switcher, journey, timeline, log activity, set stage, paste a reply) |
| 7 17 stages | `src/lib/journey/stages.ts` |
| 8 Reply and follow-up rules | `src/lib/journey/engine.ts` — reply count is a metric, meaning sets the stage; one Follow-up Sent stage with a counter (1), (2), (3), (4+); follow-ups never move a person back once past outreach |
| 9 Stage update methods | Initial CSV import, single manual update, bulk update (needs one campaign + one sender filter), CSV activity update (only new activity is added), agent-assisted reply classification (suggestion → person confirms) |
| 10 End-to-end workflow | All of the above; every change is written to the journey timeline (`JourneyEvent`) |
| 11 Stage dropdown | Stage filter chips and every stage select use the numbered list |

## Decisions made where the spec was open (please confirm)

- **Eligible to Call = Yes** when the person has a phone number, has not opted out, has engaged
  (connection accepted or replied) and the stage is not Not Interested, Disqualified or Closed.
- **Next suggested action timing:** next follow-up 5 days after the last one; after 4 follow-ups,
  suggest Nurture or close; follow up on shared details after 3 days; flag connection requests not
  accepted in 14 days. Values are in `JOURNEY_RULES` (`src/lib/journey/engine.ts`).
- **A reply in a CSV** is classified by rules at import time; pasted replies get the AI suggestion
  and a person confirms it.
- **Dates** like `20/09/2026` are read day-first; "Yes" without a date uses the import time.
- **Same person at a new company** (matched by LinkedIn URL or email): moved to the new company and
  marked for re-verification.
