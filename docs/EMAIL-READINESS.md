# Email and outreach readiness

## Workflow (code)
Draft → checks → approval → send, per client:
1. **Draft**: written by the writer from the client's Account Brain and verified facts; the compliance check (`src/lib/pipeline/gates.ts` `complianceGate`) stops a draft without an unsubscribe line or without the client's registered postal address (`sender.address` in the Account Brain).
2. **Approval**: the client's approval rule (`autonomy`: review_all / auto_t3 / auto_all), code-enforced; emails wait in Approvals.
3. **Send** (`src/lib/pipeline/stages/engagement.ts` `sendApproved`, daily check and the queue): holds a paused or archived client's emails; trips and records the bounce breaker; holds everything when no SMTP connection is set; **holds a client whose email setup is incomplete, naming exactly what is missing** (new: `sequence_send.readiness`); then per email: evidence freshness, per-company limit, suppression, contact state, the mailbox's daily limit.
4. **After sending**: messages, bounces (bounce breaker: hard-bounce rate over 7 days), replies; every decision is a pipeline event; approvals and settings changes are in the audit log.

## Readiness check (`src/lib/email/readiness.ts`)
Per client, each item with what is missing and how to fix it. Blocking: SMTP connection, an active mailbox with a daily limit, Account Brain finished, sender name and company, registered postal address, client active, sending not paused for bounces, an email sequence. Information: the approval rule, whether AI drafting is paused.
Shown on **Settings → Email readiness** (client in view) and **System health → Email readiness** (every active client). The send step uses the same check.

## Production state (read-only check, 23 Nov)
- **0 active sending mailboxes**: every client's approved emails would be held. There is no screen to add a mailbox; a developer adds it to the Mailbox table (go-live blocker).
- Registered postal address: set for manch; **missing for nicsphere, trilliant-digital, wipro-3d** (nicsphere and wipro-3d also have no finished Account Brain).
- SMTP connection: not verifiable from here (Vercel environment variables are not readable); the check shows it on the live site.
- No bounce pause open; 3 email sequences.
Nothing was sent or enabled.
