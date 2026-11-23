# Vega review (stabilization sprint)

Reviewed by reading the code and with mocked data (no model calls).

| Area | Finding | Status |
|---|---|---|
| Conversation history | Listed and loaded only for the person and the client in view (`userEmail` + `sellerId`, src/app/vega/actions.ts) | OK |
| Proposal confirmation | Confirm runs inside the client's scope, so another client's proposal is not found; the tool's policy runs again at execution | OK |
| Tool data access | Tools run inside `withScope(client)` and read through the scoped database; the engine's own bookkeeping (settings, action rows, events) is keyed by client | OK |
| Ended sessions, removed people | Vega's actions are server actions: refused by the request gate (S-5) and `logAction` | OK (S-5) |
| Activity steps with no company (scans, visitor pulls) | Were visible to every client (pipeline events with no company had no client filter), so Vega's activity views and the feeds showed other clients' work | **Fixed**: by the client they name (`data.sellerId`); others only for a full Super Admin |
| Platform-wide records for tools | Tools never saw them, even for a full Super Admin; now only a Super Admin covering every client does (`toolScope`) | **Fixed** |
| Scope wrappers and lazy queries | `withScope` / `unscoped` / `withSeller` returned an un-awaited Prisma query, which then ran outside the scope (two call sites: Vega's company lookup by link, an import duplicate check; no data exposed, the narrower request scope applied) | **Fixed** centrally: the wrappers await inside |
| Evidence and sources in answers | Actions record the evidence ids their results cite (`collectEvidenceIds`); answer quality with a live model was not evaluated (AI stays off) | Not verified live |

Left for later: evaluating answer relevance with a live model once AI is resumed; a per-answer source list in the chat panel.
