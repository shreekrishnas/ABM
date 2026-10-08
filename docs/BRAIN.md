# The ABM brain (v2) — backend only

The brain has no screen of its own. It runs in the backend on every import and on a daily
schedule (Vercel Cron → `GET /api/v1/tick`, protected by `CRON_SECRET`). Its results show
up where people already work: company pages (facts, account summary, drafts, audit trail),
the Review queue and People.

## Seller packs (`src/lib/seller`)
Every account has a `sellerId`. A run loads that seller's pack, validates it
(`seller/schema.ts`) and makes it the brain's identity for the whole run (`withSeller`).
ICP, research questions and search terms, extraction guides, triggers, use cases, proof,
tone, banned claims, sender address and autonomy level all live in the pack. Every fact,
brief, draft, signal and decision stores `sellerId` + pack version. Adding a seller =
adding a pack; `tests/brain-v2.test.ts` fails if core code mentions a seller.

## Main brain and signal bus (`brain/bus.ts`, `pipeline/orchestrator.ts`)
Modules publish typed, stored signals (`BrainSignal`): seller.context, run.planned,
fit.scored, research.done, evidence.judged, brief.ready, verdict.conflict,
readiness.decided, draft.critiqued, draft.rewritten, draft.ready, run.finished,
learning.summary, proposal.created. `replay({accountId})` replays a run.
Conflict rule: if the strategist says strong and the evidence judge says weak, the weaker
verdict wins until re-research.

## Decisions with both sides (`brain/decisions.ts`)
Each judgement stores the choice, case for, case against, evidence for each, a confidence,
and whether the brain acted or stopped at a fence (`Decision`).

## Truth before speed
A fact is kept only with an exact quote that code finds on the source page (`quoteGate`).
The claim checker sees each fact with its quote.

## Writer → critic panel → rewriter (`stages/outreach.ts`)
Critics: truth (code), truth (model, with quotes), compliance + banned claims (code),
style/relevance (model). Failing issues go to the rewriter; at most
`CONFIG.loops.maxDraftVersions` versions, then a person. Autonomy level (pack):
review_all | auto_t3 | auto_all — enforced in code; a critic that could not run always
means a person reviews.

## Email channel (only outbound channel)
Live mode never uses sample people: `NoProvider` (only imported people until Apollo),
free MX check (`probable`, never `verified`), SMTP sending when `SMTP_URL` is set; without
it approved emails are held, never pretended sent. LinkedIn, website intent and calling
are parked.

## Model output
Every LLM call is schema-validated; invalid output is retried once with the validation
error, then the module falls back to rules or a person.

## Learning
Daily: reviewer verdicts (by use case, by rewrites), LinkedIn progress (by sender, role),
fact precision, engine yield, email replies. Small samples are labelled tentative. Engine
routing is applied automatically; everything else becomes a `Proposal` + Review item —
never applied without a person and a test.
