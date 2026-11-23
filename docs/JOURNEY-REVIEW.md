# ABM journey review (stabilization sprint)

Setup → Discover → Research → Prioritize → Contact discovery → Engage → Approvals → Outreach → Results.
Evidence from the code and production data (read-only, 23 Nov; after a client's data was cleared at 11:25
UTC through the app, production holds 11 companies).

| Question | Finding | Evidence |
|---|---|---|
| Next action clear on every page? | **No for stopped companies**: 4 of 11 were stopped; two (no usable person, research incomplete) showed no reason or step on their page, and the Companies list didn't show which were stopped at all | `pipelineStatus` blocked ×4; company page banner covered only proposed rejections and possible blockers |
| Information flows between stages? | Mostly: research facts feed priority and drafts; visits feed intent; decisions land in Approvals | one shared waiting count; Approvals opens items from Home, Today, Vega |
| People repeat work? | "Decide" on a company opened Approvals filtered by type, not the item: with 8 open identity conflicts, the person searched again | `/review?type=…` without `pick` |
| Company intelligence actionable? | Yes where research finished: "What we know", sources and confidence; stopped companies didn't say what would finish them | research summary; stop reasons only in events |
| Buying intent understandable? | Intent shows with its signals (visits, triggers); visitor topics now in the client's own words (P3) | |
| People discovery leads to engagement? | Weak link: 60 people without an email, and a company stopped for "No ready contacts" offered no step | contacts with no email: 60 |
| Why an account is prioritized? | Priority shows tier and the verdict with why | brief `nextBestAction`, `verdictWhy` |
| Results show progress? | 0 emails sent (no mailbox: see EMAIL-READINESS.md), so results can't show outreach progress yet | messages sent: 0 |

## The three changes (evidence-based)
1. **A stopped company says why and offers the one step that moves it on** (company page): decide in Approvals (that exact item), research again, see who was found, or run again.
2. **The Companies list marks stopped companies with the reason, and has a "Stopped: needs a step" filter.**
3. **"Decide" opens the exact item in Approvals** (`pick=`), not the filtered list.

## Left for later
- A way to add a person by hand and to request an email (approval-gated) from the company page: the "No ready contacts" step today leads to the people found, not to adding one.
- Results page once outreach runs.
