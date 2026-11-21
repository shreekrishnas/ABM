# 05 · Third-party integrations

**How adapters switch on** (`src/lib/adapters/index.ts`):
- Each service goes live when its key is present. `ADAPTER_MODE=mock` forces mocks everywhere (`src/lib/adapters/mock.ts`).
- Real runs **never fall back to sample data**. Stand-ins such as `DisconnectedResearch`, `NoProvider`, `DisconnectedSender` and `NoIntent` make the gap visible.
- `serviceStatus()` drives `/admin/integrations`.

**Keys** (`src/lib/integration-keys.ts`):
- A Super Admin enters keys in the app. They're stored AES-256-GCM encrypted, and only the last four characters are ever shown.
- An in-app key overrides the same environment variable. Keys are laid over `process.env` with a 30-second cache.

**Shared HTTP** (`src/lib/adapters/live/http.ts`):
- 25 s timeout.
- Retries after 1 s and 3 s on 429, 5xx and network errors, honouring Retry-After.
- Per-service circuit breaker: after 5 failures it pauses for 2 minutes.
- Error messages never include the key.

| Service | Purpose | Auth (type only) | Operations implemented | Paging, sync and errors | Limits and gaps |
|---|---|---|---|---|---|
| **OpenRouter** (`live/openrouter.ts`, `live/embeddings.ts`) | All LLM calls and embeddings | Bearer key | chat completions; embeddings | JSON mode, zod validation, one retry; 45–60 s timeouts | Model choice is set by env; no streaming; prompt quality isn't tested in CI |
| **Exa / Tavily / SerpAPI** (`live/research.ts`) | Web search for research | API key (header or query) | Exa search and findSimilar; Tavily search; SerpAPI search | 48 h `SearchCache`; any one engine is enough | Research needs both a search key and an LLM key |
| **Page reader** (`live/reader.ts`) | Reads source pages | None | GET | Respects robots.txt; 24k-character cap | Pages that need JavaScript to render may come back thin [Assumption] |
| **Apollo** (`live/apollo.ts`, `src/lib/web/apollo-sync.ts`) | People search, email match (costs credits), website-visitor companies | `x-api-key` header | people search, people match, labels, accounts search | Visitors: up to 5 pages × 100; 20 s timeout; clear messages for 403 and 429; the daily pull runs inside the owning client and logs an `apollo.visitors` error event | Contact lookup only for approved companies (`approvalGated`); one visitor site per installation (`APOLLO_VISITOR_SITE`) |
| **SMTP** (`live/email.ts`) | Sends approved emails; login links | SMTP URL credentials | send | Without SMTP, approved emails are held | No open or click tracking; replies arrive via the webhook. **A compliance postal address is still a TODO** (`src/lib/seller/<built-in seller>.ts:179`) |
| **DNS MX check** | Checks a mailbox domain exists | None | DNS | | |
| **BuiltWith** (`src/lib/profile/builtwith.ts`) | Technology lookup | API key | domain API | Optional | Only runs when research is live |
| **Careers boards** (`src/lib/signals/jobs.ts`) | Hiring signals | Public | Greenhouse, Lever, Ashby, Workable JSON | Sites with none of these are marked "none" so they aren't re-read | Other job boards aren't covered |
| **Website tech detection** (`src/lib/profile/website.ts`) | Detects tech from the company's own site | None | Homepage plus one other page | | Heuristic |
| **Inbound webhooks** | Replies, signals, visitors | Per-client API key, plus an optional HMAC `X-ABM-Signature` | POST | Replies are matched to their thread with `<draftId@…>` | **The signature isn't checked when `WEBHOOK_SECRET` is unset** |
| **Tracking beacon** (`api/v1/track`) | First-party page views | Origin allowlist | POST and a JS script | | Open to any origin outside production; rate limiting relies on the global proxy limit only [Verify] |
| **LinkedIn** (`src/lib/linkedin`) | Note drafts and conversation tracking | — | — | — | **No API: a person copies and sends** |
| **CRM** (`src/lib/crm`) | Deal board | — | Internal only | — | No Salesforce or HubSpot |
| **Intent data** | — | — | `NoIntent` | — | No provider integrated |
| **Slack / Teams** | Alerts | — | Marked "planned" | — | Not built |

**Field mapping:**
- Imports map columns through `src/lib/import/fields.ts`.
- Apollo people go to `Contact` (name, title, email, LinkedIn); visitor accounts go to `WebVisit` and `ProspectSuggestion`.
- **[Verify]** Check the exact Apollo field coverage against a live response, which this engagement did not fetch.

**Not inspected:** live API behaviour, provider dashboards, and the live environment variables (the Vercel environment API returned 403).
