# Trilliant AI Research Brain — Current Architecture Audit

*Static, read-only inspection of the repository on branch `claude/clever-noether-kff67l` (2026-10-28). No code was run against live services, no research was executed, and no data was changed. Line numbers refer to the files as they stand at this commit.*

**Status labels**
- **IMPLEMENTED:** code does it end to end.
- **PARTIAL:** code does some of it, or does it only under certain conditions.
- **MISSING:** no code does it.
- **UNKNOWN:** cannot be decided from static inspection.

---

## A. Executive summary

The research "brain" is a **fixed, code-orchestrated pipeline with LLM calls at specific steps**. It is not an autonomous agent. One small, cheap model (default `openai/gpt-4o-mini` via OpenRouter) is used for every LLM step. Code decides:
- which questions are asked
- how many questions are asked
- when research stops
- whether a fact counts
- whether a company is qualified, parked or rejected

The LLM does four jobs:
- writes search queries
- extracts quoted facts from short page excerpts
- writes cautious inferences and a sales brief
- drafts and critiques emails

**Strengths, all backed by code:**
- **Quote verification:** every stored fact must carry a quote that is found again on the source page. Matching is fuzzy, but numbers must match exactly.
- **Entity check:** the source must name the company.
- **Freshness windows:** facts expire after a set number of days.
- **Fact status:** a fact is "verified" if it has an official source or two different hosts; otherwise it is "probable".
- **Blocker wording check:** negative "blockers" are checked against the sentence wording in code.
- **Single-source protection:** a blocker reported by one source cannot reject a company on its own.
- **Email claim tracing:** every email claim must cite a stored fact ID and is checked twice, once by code and once by a model.
- **Recovery:** retries with backoff, recovery of stuck runs, and per-tier spending caps.

**Main limits, all backed by code:**
1. **Research breadth is predefined.** The questions come from a fixed list in the seller pack (Manch: 11 questions). How many get asked depends on tier: T3 gets at most 4, T2 at most 7, T1 at most 10. There is no open-ended discovery inside account research.
2. **Research depth is shallow.**
   - One search per question.
   - At most 5 pages, taken from the first engine that returns anything.
   - The model sees about 1,800 characters of each page: a snippet, not the full article.
   - SerpAPI and Tavily return search snippets only.
3. **Few follow-ups.** Each company gets one broadened follow-up per run, one corroboration pass, and one re-open for contradictions.
4. **Facts and buying intent are linked by fixed rules.** The connection comes from keyword lists, fixed weights and half-lives, and a fixed "family" per question. No model reasons over the combined evidence when the decision is made. The model's "verdict" in the brief does not gate anything.
5. **"Strong evidence" can be reached on one article.** Two *probable* trigger claims count as strong (`minUsableTriggers: 2`), and nothing requires them to come from different sources. Two claims pulled from the same article therefore pass the readiness gate.
6. **Automatic rejection without a person is possible.** It happens in four situations:
   - targeting rules (country or size)
   - fit below 40
   - exclusions (customer, competitor, partner, do-not-contact, recent lost deal)
   - a *confirmed* terminal blocker (one official source or two different hosts)
7. **No independent research validator.** "Validation" consists of deterministic gates on each fact plus a check that the model's cited fact IDs exist. Nothing re-reads the research, challenges a conclusion, or decides research is incomplete beyond the fixed rules.
8. **Fake "intent surges" on real accounts.** The third-party intent provider is never connected; a mock that derives scores from a hash of the domain can trigger re-research of watched accounts (see I-16).
9. **A config combination can silently weaken extraction.** If search keys are set but `OPENROUTER_API_KEY` is not, live pages go through the **mock** extractor. It turns page titles into "facts" and labels unrecognised negatives as "layoffs" (see I-12).

---

## B. Current architecture and component responsibilities

### B.1 Models

| Use | Model | Evidence | Status |
|---|---|---|---|
| All LLM steps: planning, extraction, inference, brief, drafting, critique, claim check, reply classification | `process.env.LLM_MODEL` or the default `openai/gpt-4o-mini` via OpenRouter; temperature 0.2; JSON output | `src/lib/adapters/live/openrouter.ts:38`, `:51-56` | IMPLEMENTED |
| Embeddings (knowledge base for drafting) | `EMBED_MODEL` or the default `openai/text-embedding-3-small` | `src/lib/adapters/live/embeddings.ts:12` | IMPLEMENTED |
| Fallback when no key is set | A deterministic **mock** LLM plus a rule-based "brain" | `src/lib/adapters/index.ts:57-66`, `src/lib/adapters/mock.ts`, `src/lib/brain/rules.ts` | IMPLEMENTED |
| Model used in production | Depends on Vercel environment variables | Not in the repo | UNKNOWN |

All roles use the same model. There is no stronger model for reasoning and no separate validator model. `costsUsd.llmStrong` (`config.ts:95`) is only a cost label.

### B.2 Components (called "modules" in the code)

The orchestrator labels them in `MODULE_OF` (`orchestrator.ts:218`). They are functions run in sequence, not independent agents.

| Component | Code | Responsibility | LLM? |
|---|---|---|---|
| Main brain / orchestrator | `src/lib/pipeline/orchestrator.ts` `runWithSeller` (L137-216) | Runs stages 2–11 in a fixed order; handles the re-research loop, tier upgrade, errors and retries | No |
| Intake gap-fill (stage 2b) | `src/lib/research/intake.ts` `fillGaps` (L197-255) | Searches for a missing website and firmographics | `extractFirmographics` |
| Fit, tier and exclusions (stage 3) | `src/lib/pipeline/stages/data.ts` `s03FitTier` (~L110-175) | Exclusions, must-have targeting rules, fit floor, tier | No |
| Research planner (stage 5) | `stages/research.ts` `s05ResearchPlan` (L32-79), `src/lib/brain/plan.ts` `directResearch` (L47-75) | Picks questions from the seller pack and applies caps; the LLM rewrites queries and picks engines | `planResearch` (with a rule fallback) |
| Search router (stage 6) | `src/lib/adapters/live/research.ts` `WebResearch.search` (L114-142) | Exa, Tavily or SerpAPI with fallback order; filters pages to those mentioning the company | No |
| Extractor (stage 6) | `openrouter.ts` `extractEvidence` (L79-111) | Turns pages into claim, quote, value and kind | Yes |
| Evidence gates (stage 6) | `src/lib/pipeline/gates.ts` `quoteGate` (L163-173), `entityGate` (L185-191), `evidenceGate` (L103-110) | Quote is on the page, page names the company, URL, type and date present | No |
| Evidence judge / account twin (stage 7) | `stages/research.ts` `s07AccountTwin` (L258-346); `gates.ts` `factStatus` (L215-222), `findContradictions`, `resolveContradiction` | Fact statuses, contradictions, unknowns, twin snapshot | `infer` (≤3 inferences) |
| Strategist | `src/lib/brain/strategist.ts` `buildBrief` (L50-102), `sanitizeBrief` (L17-38) | Verdict, why-now, pain points, persona angles; drops cited IDs that don't exist | `accountBrief` (with a rule fallback) |
| Intent engine | `src/lib/brain/intent.ts` `collectSignals` (L248-317), `scoreIntent` (L220-245) | Turns evidence, journeys and signals into a 0–100 score with families and convergence | No |
| Readiness gate (stage 10) | `stages/outreach.ts` `s10Readiness` (L34-109); `gates.ts` `decideReadiness` (L388-413), `negativeEvidence` (L345-361), `blockerSupported` (L313-337) | Disqualify, watch, re-research, human review or ready | No |
| Writer, critic panel and rewriter (stage 11) | `outreach.ts` `draftForContact` (L136-330) | Draft, then code and model critics, then up to 3 versions | `draft`, `checkClaims`, `critiqueDraft` |
| Market scan (outside account research) | `src/lib/discover/scan.ts` | Finds new companies from news for seller triggers | `extractMarketEvents` |

**How the components communicate:**
- **Direct function calls** with shared DB rows: `Evidence`, `ResearchPlan`, `ResearchQuery`, `TwinVersion`, `AccountBrief`, `Draft`, `ReviewItem`.
- **An event "bus":** `publish()` in `src/lib/brain/bus.ts`, used at `orchestrator.ts:150-153, 222-247`. No code in the pipeline path *consumes* these events to change control flow; they are a record. **IMPLEMENTED as logging; MISSING as messaging between agents.**
- **A decision log:** `decide()` writes the case for and against (`orchestrator.ts:234, 248`; `outreach.ts:287, 315`). It is a record and does not gate anything.

### B.3 Prompts that control behaviour

All prompts live in `src/lib/adapters/live/openrouter.ts`:

| Prompt | Lines |
|---|---|
| Shared `BRAIN` preamble ("never invent facts… label hypotheses") | L31-34 |
| `BLOCKER_DEFINITIONS` | L20-26 |
| extractEvidence system prompt ("Extract only what a page states explicitly… copy the exact sentence") | L95-96 |
| infer ("at most 3 cautious inferences… list fact ids") | L118-119 |
| planResearch | L232-249 |
| accountBrief | L252-275 |
| draft rules 1–7 | L157-174 |
| critiqueDraft | L186 |
| checkClaims | L282 |

The question text, search terms and extraction guidance per question come from the seller pack (`src/lib/seller/manch.ts:121-148`).

---

## C. End-to-end research workflow

### C.1 Workflow diagram

```
 Import / Apollo / market scan
            │
            ▼
 [2] Clean + gap-fill  ── search "website" / "firmographics" → LLM extractFirmographics
            │
            ▼
 [3] Fit & tier ── exclusion? ──► DISQUALIFIED / CUSTOMER / OPPORTUNITY (StopRun)
            │      must-have fail? ──► DISQUALIFIED      unknown? ──► stop, no spend
            │      fit < 40? ──► DISQUALIFIED
            ▼
 [4] Identity (emails)
            │
            ▼
 [5] Research plan ── seller question list → caps by tier/intent → LLM rewrites queries
            │
            ▼
 [6] Research ── per question: 1 search (cache 7d) → ≤5 pages from first engine with hits
            │     → LLM extracts {claim, quote} → quote gate → entity gate → evidence gate
            │     → store Evidence(status=probable)
            │     └─ unanswered HIGH questions → 1 broadened follow-up (once per run)
            ▼
 [7] Twin ── contradictions (official wins | reopen once | human review)
            │   → factStatus: verified/probable/stale → LLM infer (≤3)
            │   → LLM brief (pain points, angles; unsupported cites dropped)
            │   → intent score; if HOT and not T1 → upgrade T1, redo 5–7 once
            ▼
 [8] Buying group  [9] Enrichment
            │
            ▼
 [10] Readiness ── confirmed terminal blocker ──► DISQUALIFIED (no human)
            │       unconfirmed terminal blocker ──► possible_blocker review (paused)
            │       confirmed layoffs/freeze ──► WATCH 90d
            │       weak triggers & no follow-up yet ──► re-research trigger once ─┐
            │       weak after follow-up ──► WATCH 30d                             │
            │       per person: identity/lawful basis/role ──► human_review or ready
            ▼                                                                      │
 [11] Draft ── writer → truth(code) → truth(model) → playbook → specificity →   ◄──┘
               compliance → style(model); ≤3 versions → blocked | pending_review | approved
```

### C.2 Stage notes with evidence

1. **Linear order.** `LINEAR` (`orchestrator.ts:29-39`). Stage 10 and the single re-research loop are at L164-177; stage 11 is at L179-181. **IMPLEMENTED.**
2. **Question selection** (`research.ts:46-64`). The rules are:
   - skip `culture` (`config.ts:35`)
   - skip `tooling` if the import listed technologies
   - skip keys that already have fresh verified or probable evidence (except `negative`)
   - apply the deep-question allowance and the question cap from `researchDepth`

   **IMPLEMENTED.**
3. **LLM planning** (`plan.ts:62-73`; `mergePlan` L23-45). The LLM may:
   - skip non-high questions
   - rewrite queries (accepted only if the query contains the company's first word)
   - choose an engine

   If the LLM fails, `rulePlan` builds the queries instead (`rules.ts:10-31`). **IMPLEMENTED.**
4. **Searching** (`research.ts:95-138`, `live/research.ts:114-142`):
   - The cache key is `key|primary` for main and refresh passes. A re-run within 7 days reuses the stored pages (`config.ts:104`).
   - Engine order: the brain's choice first, then Exa → Tavily → SerpAPI for main passes, or SerpAPI → Tavily → Exa for follow-ups.
   - The **first engine with ≥1 page mentioning the company's first word wins**, and at most 5 pages are kept.

   **IMPLEMENTED.**
5. **Extraction and gates.** See section D. **IMPLEMENTED.**
6. **Account twin and brief** (`research.ts:258-346`). **IMPLEMENTED.**
7. **Readiness and drafting.** See sections F and G.

---

## D. Source-to-signal reasoning process

### D.1 Source → business event (extraction)

| Question | Finding | Evidence | Status |
|---|---|---|---|
| How does it search? | Keyword-style queries: company name in quotes plus OR-lists of seller terms (`manch.ts:123, 125, 129…`), or the LLM-rewritten query. Date windows per question (`days`). | `live/research.ts:11-22`; `plan.ts:40` | IMPLEMENTED |
| Full content or snippets? | **Exa:** up to 2,500 characters of page text (`live/research.ts:61, 71`). **Tavily:** title plus `content` snippet, max 2,000 (`:90`). **SerpAPI:** title plus Google snippet, max 1,500 (`:104`). The extractor then truncates each page to **1,800 characters** (`openrouter.ts:96`). No step fetches the full article. | as cited | **PARTIAL** (snippets/excerpts only) |
| Undated results | Dropped, except for website and firmographics lookups (`live/research.ts:69-70, 88, 102-103`) | — | IMPLEMENTED |
| Relevance pre-filter | The page must contain the **first word** of the company name, or the URL must contain the domain (`live/research.ts:123, 136`). A generic first word ("Indian …", "The …") weakens this filter. | — | PARTIAL |
| Extraction prompt | "Extract only what a page states explicitly — never infer or combine pages… copy the exact sentence" (`openrouter.ts:95`). Up to 8 items per question (`:98`). | — | IMPLEMENTED (behaviour as instructed: UNKNOWN until tested on real data) |
| Claim ↔ source link | `sourceUrl`, `publishedAt` and `sourceType` come **from the fetched page, not from the model** (`openrouter.ts:100-109`). The quote is stored (`research.ts:191`). | — | IMPLEMENTED |

### D.2 Verification gates (code)

Order of application: `research.ts:168-174`.

- **`quoteGate`** (`gates.ts:163-173`). In live mode a quote is required (≥12 characters). It must match the page word for word, or reach ≥85% fuzzy match with **all numbers present on the page** and ≥6 words. **IMPLEMENTED.**
  - Limit: it proves the quote exists on the page, **not that the claim says the same thing as the quote**. The claim text is model-written and is not checked against the quote.
- **`entityGate`** (`gates.ts:185-191`). The page (title, text or URL) must contain a distinctive word of the company name or the domain root. **IMPLEMENTED.** It does not check that the *quoted sentence* is about the company. A page that mentions the company once and quotes an event about another firm can pass. **PARTIAL.**
- **`evidenceGate`** (`gates.ts:103-110`). URL, type and date present; date not in the future; no mock sources in live mode. **IMPLEMENTED.**
- **Duplicate check.** The same `(account, key, sourceUrl)` is stored only once (`research.ts:176-180`). **IMPLEMENTED.**

### D.3 Credibility, freshness, corroboration

- **Source credibility.** Classification is by URL pattern only: `classifySource` (`live/research.ts:24-39`) returns official, careers, press, review_site or news. Weighting:
  - "official" (the company's own domain) or "provider" counts as verified on its own (`gates.ts:204, 219`).
  - All other non-official sources count the same; there is no reputation scoring per publisher.
  - Press-release wires count as "press" (non-official).

  **PARTIAL.**
- **Outdated information.** `freshnessDays` (`config.ts:23-29`): trigger 90, company 180, negative 90 days. Stale facts are marked `stale` (`gates.ts:215-218`), excluded from usable facts and rejected by the email guardrail (`gates.ts:438-439`). **IMPLEMENTED.**
- **Cross-checking.** `factStatus`: two or more fresh items on **different hosts** with the same `(key, value or claim)` group give verified (`gates.ts:220-221`). Grouping is by exact lower-cased text (`research.ts:291`). Two sources for the same event are grouped only if the extractor sets `sameAs` to an existing fact ID, which copies that fact's wording (`research.ts:181-189`). **PARTIAL:** corroboration depends on the model choosing `sameAs` correctly.
- **Second-source search.** Follow-up passes run `corroborationQuestions`, which searches a different engine for the best single-source trigger (`research.ts:232-241`). Only one trigger is chased, once. **PARTIAL.**
- **Syndicated copies.** Mirrored copies of one wire story on two hosts count as two independent sources. Nothing detects copies. **MISSING.**

### D.4 Business event → interpretation → buying-intent signal

| Step | What code does | Evidence | Status |
|---|---|---|---|
| Event → "trigger" label | A fact is a trigger if its question key is `trigger` or marked `trigger: true` in the pack (`erp_program`, `expansion`, `leadership`). This depends on **which question found it, not what it says**. | `research/keys.ts:7-9` | IMPLEMENTED (key-based) |
| Trigger type | `classifyTrigger(text)` returns the **first pack trigger whose keyword appears** in the claim | `seller/fit.ts:109-112` | IMPLEMENTED (keyword) |
| Interpretation | `infer()` produces ≤3 "cautious inferences" that must cite fact IDs; invalid ones are dropped (`research.ts:305-311`). Inferences go into the brief prompt as text but **do not feed intent or readiness**. | `openrouter.ts:113-123` | IMPLEMENTED, decision impact: none |
| Signal family | Fixed per question (`q.family`, e.g. `programme` or `leadership`); otherwise `owner_function` maps to hiring and trigger keys map to trigger | `intent.ts:210-217` | IMPLEMENTED |
| Signal strength | `statusWeight` (verified 1, probable 0.65, stale 0.25) × recency decay (fixed half-life per family) × corroboration (0.75 + 0.25 per extra source URL, cap 1) | `intent.ts:200-205, 271-274` | IMPLEMENTED (fixed formula) |
| Combination | Per-family diminishing sum × fixed weights; convergence bonus +5, +12 or +20 for 2, 3 or ≥4 families; a single family is capped at 45; **hot** = ≥65 and ≥2 families | `intent.ts:220-245` | IMPLEMENTED |
| Multi-source connection | Convergence across *families* is the only cross-evidence reasoning used in decisions. The brief LLM sees all facts together, but its output does not gate anything. | `intent.ts:232-237`; `orchestrator.ts:246-253` | PARTIAL |
| Facts vs assumptions | Separated in storage: `Evidence` (facts, quote-gated); `TwinVersion.inferences`; `AccountBrief.painPoints` (the prompt says "the pain itself is an inference") and `hypotheses`. | `research.ts:248-256`; `openrouter.ts:255` | IMPLEMENTED |
| Business activity vs buying intent | **No code distinguishes them.** Any non-negative fact on a trigger key counts as a trigger for readiness (`outreach.ts:40`; `gates.ts:279-288`). Whether the event actually creates a need for the seller is decided only by the extraction prompt's guidance (`openrouter.ts:83`). | — | **MISSING** (prompt-only) |
| Misleading keywords | **Possible.** Search terms are broad OR-lists (e.g. `acquisition OR funding OR expansion OR distributors…`, `manch.ts:123`). `classifyTrigger` is keyword-first-match. The relevance filter is first-word-of-name. Blocker kinds have a regex wording check (`gates.ts:313-337`); **positive triggers have no such check**. | — | Risk confirmed by code |

---

## E. Research completeness and validation mechanisms

### E.1 Completeness

| Question | Finding | Evidence | Status |
|---|---|---|---|
| What marks research complete? | Nothing measures it. Stage 6 ends after each planned question has been searched once, plus the follow-up. Unanswered questions are recorded as `unknowns` in the twin (`research.ts:320-322`) but do not block progress. | — | **MISSING** as a completeness criterion |
| Mandatory categories | The seller pack's questions with `importance: "high"` (`trigger`, `owner_function`, `negative`) cannot be skipped by the LLM (`plan.ts:35`). They can still be **skipped by code** if already fresh, or by the tier cap: questions are taken in pack order and the cap applies (T3 cap 4, `intake.ts:131`). | — | PARTIAL |
| Can it stop too early? | Yes, in these cases:<br>• one search per question; the first engine with any relevant page ends the search (`live/research.ts:138`)<br>• follow-up limited to one per run (`research.ts:218`, flag `followupUsed`)<br>• the readiness re-research runs only on the `trigger` key, once (`orchestrator.ts:168-175`)<br>• T3 accounts never get deep questions | — | Confirmed |
| No signal found | Readiness:<br>• `targeted_re_research` once<br>• then **WATCH 30 days** (`gates.ts:395-397`; `outreach.ts:64-70`)<br>• the watchlist re-runs from stage 5 when due (`orchestrator.ts:264-274`) | — | IMPLEMENTED |
| No negative news found | Counts as answered: "No negative news found — counts as an answer" (`research.ts:152-154`). An empty result caused by the relevance filter also counts as "no negatives". | — | IMPLEMENTED (with that caveat) |
| Identifying missing coverage | `unknowns` lists planned keys without usable facts. They go into the brief prompt (`openrouter.ts:262`) and the handoff briefing. **Nothing triggers new research from unknowns**, apart from the trigger-key loop. | — | PARTIAL |
| Uncertainty | Expressed through:<br>• fact status (verified / probable / stale / conflicting)<br>• intent level<br>• brief `confidence` per pain point<br>• `dataConfidence` (`research.ts:340`)<br>There is no uncertainty threshold beyond the readiness counts. | — | PARTIAL |

### E.2 Validation

| Question | Finding | Status |
|---|---|---|
| Independent validation of research? | **No separate validator.** Validation is the deterministic gates (D.2) plus `sanitizeBrief`, which keeps only cited fact IDs that exist and valid use-case keys, and downgrades "strong" to "moderate" when no pain point survives (`strategist.ts:17-38`). | **MISSING** (as an independent reviewer) |
| What is validated | The quote is on the page; the page names the company; URL, date and type exist; cited IDs exist; inference `basedOn` IDs exist (`research.ts:309`). | IMPLEMENTED |
| Factual accuracy of claim vs quote | Not checked at research time. It is checked only at **email time**: `checkClaims` gives the model each email claim with the cited fact and its quote (`outreach.ts:202, 233`). | PARTIAL (downstream only) |
| Challenging conclusions | The only "challenge" is `afterModule`: if the brief verdict is "strong" but the evidence is weak, a decision record says the evidence wins (`orchestrator.ts:246-253`). It is a log entry; readiness is evidence-driven anyway. | PARTIAL (record only) |
| Requesting more research | Code-driven only:<br>• one broadened follow-up<br>• one trigger re-research<br>• one contradiction reopen (`research.ts:273-277`)<br>• one T1-upgrade re-plan (`orchestrator.ts:230-239`) | IMPLEMENTED with fixed caps |
| Contradictions | Applies only to keys `partner_network` and `owner_function` (`research.ts:246`):<br>• official source wins (`gates.ts:245-251`)<br>• otherwise reopen once<br>• otherwise mark both `conflicting` and open a `contradiction` review<br>Contradictions between **trigger** facts are not detected. | PARTIAL |
| Round limits | `CONFIG.loops.maxReResearch: 1`, `maxDraftVersions: 3` (`config.ts:126-131`); flags `followupUsed` / `reopenUsed` on the account | IMPLEMENTED |

---

## F. Decision-making and human approval rules

| Decision | Rule | Evidence | Human? |
|---|---|---|---|
| Exclusion | Customer, competitor, partner, do-not-contact, open opportunity, or lost deal < 90 days | `gates.ts:28-38`; `data.ts` s03 (~L116-127) | **No:** sets `DISQUALIFIED` / `CUSTOMER` / `OPPORTUNITY` automatically |
| Targeting rules | Country or minimum size fails → `DISQUALIFIED`; unknown → stop without spending | `gates.ts:44-57`; `data.ts` ~L131-139 | **No** |
| Fit floor | Fit < 40 → `DISQUALIFIED` | `gates.ts:59-62`; `config.ts:9`; `data.ts` ~L147-157 | **No** |
| Qualification | Tier from size or fit (`config.ts:10`); upgrade to T1 when intent is hot | `data.ts` ~L170-172; `orchestrator.ts:230-239` | No |
| Proceed to contact research | Stages 8–9 always run after stage 7; readiness is evaluated after them | `orchestrator.ts:29-39` | No |
| Confirmed terminal blocker | acquired, bankrupt or competitor_signed, passing the wording check, from one official source or ≥2 different hosts → `DISQUALIFIED` | `gates.ts:345-351`; `outreach.ts:51-55` | **No** |
| Unconfirmed terminal blocker | One source only → `possible_blocker` review; run paused | `gates.ts:352-355`; `outreach.ts:57-63` | **Yes:** Keep / Research again / Approve rejection (`actions.ts:797-828`) |
| Layoffs or hiring freeze | Confirmed and within 90 days → WATCH 90 days; unconfirmed → ignored for decisions (it still subtracts from the intent score: `intent.ts:281-284`) | `gates.ts:356-359` | No |
| Weak evidence | Fewer than 1 verified and fewer than 2 usable triggers in 90 days → re-research once → WATCH 30 days | `gates.ts:394-397` | No |
| Inconclusive research | No explicit state; ends up as WATCH (above) or `StopRun("Evidence still weak after re-research")` (`orchestrator.ts:174`) | — | No |
| Per person | Email, title or company not verified/probable, or no lawful basis → human review; email undeliverable → human review; role not decision maker or champion → human review | `gates.ts:399-410` | Yes (review items) |
| Email send approval | `needsHumanApproval(tier, autonomy)`:<br>• `review_all` → always<br>• `auto_t3` → T1 and T2 need approval<br>• `auto_all` → never<br>• always when a critic could not run, or the draft replaces a held draft | `gates.ts:458-462`; `outreach.ts:299-300` | Configurable; production value is set in the seller pack (`seller().autonomy`) and is **UNKNOWN** here |

**Can a company be permanently rejected without a person?** Yes. There are four paths: exclusion, targeting rules, fit floor, and a confirmed terminal blocker. Each sets `stage: "DISQUALIFIED"` with no review item.
- "Permanent" is relative. `prepareReResearch` lifts a disqualification only when `disqualifyReason` starts with "Negative evidence" (`orchestrator.ts:75`).
- A fit or targeting rejection is re-evaluated only if the company is re-run from stage 3, for example after a new import (`data.ts` ~L143 clears the reason when the rule now passes).
- No automatic reconsideration schedule exists for these rejections. **IMPLEMENTED / risk.**

---

## G. Email-drafting dependencies

| Question | Finding | Evidence | Status |
|---|---|---|---|
| Fields passed downstream | Passed to the writer:<br>• `facts` (id, key, claim) for non-negative, verified or probable, non-future facts<br>• `angle` (pain hypothesis, capability, persona, why-now, proof point) from the brief<br>• `signals` (top 3 intent labels, visits removed)<br>• `interest` (website topic)<br>• seller pitch, CTA, tone, banned claims, playbook, persona<br>• RAG references and examples<br>• learnings | `outreach.ts:127-130, 170-200` | IMPLEMENTED |
| Can unverified assumptions enter drafts? | **Yes, in four ways:**<br>1. Probable (single-source) facts are usable (`outreach.ts:129`).<br>2. The pain point is passed as a hypothesis with an instruction to phrase it as a question (`openrouter.ts:169`); this is prompt-enforced and checked only by the style critic.<br>3. `signals` and `angle.whyNow` labels (e.g. LinkedIn conversation summaries) are given to the writer without fact IDs. Rule 7 says prospect statements must still cite a fact, but a LinkedIn conversation "may be referred to".<br>4. The truth critics only check sentences the **model itself lists in `claims`**. An assertion left out of `claims` is not checked by `factGuardrail` or `checkClaims`; only `critiqueDraft` (model, style) might catch it. | `openrouter.ts:164-171, 186`; `outreach.ts:225-247` | Risk confirmed |
| Supporting sources preserved? | Yes. The draft stores `claims` with `factIds` and `leadEvidenceId`. Each fact keeps `sourceUrl` and `quote`. The claim checker sees "claim (source says: quote)". | `outreach.ts:202, 306` | IMPLEMENTED |
| Facts vs hypotheses in drafting | Facts have IDs; the angle's pain is labelled a hypothesis in the prompt and in the decision record (`outreach.ts:319`) | — | PARTIAL (prompt-level) |
| Safeguards | Truth (code) `factGuardrail`: each listed claim cites ≥1 existing, usable, fresh fact (`gates.ts:429-443`). Truth (model) `checkClaims` (`openrouter.ts:278-287`). Playbook `checkPlay`. Specificity (`gates.ts:479-489`). Compliance and banned claims (`gates.ts:445-451, 496-503`). Style critic. ≤3 versions, then `blocked` plus a `guardrail_failed` review (`outreach.ts:283-294`). | — | IMPLEMENTED |
| Draft requires a trigger | No usable trigger fact → no draft (`outreach.ts:159-162`) | — | IMPLEMENTED |

---

## H. Technical reliability

| Area | Finding | Evidence | Status |
|---|---|---|---|
| HTTP timeouts | 25 s default; OpenRouter 45 s; one retry on network error, 429 or 5xx after 1.5 s | `live/http.ts:10-29`; `openrouter.ts:58` | IMPLEMENTED |
| LLM output validation | Zod schema; one retry with the error message; then an exception | `openrouter.ts:64-77` | IMPLEMENTED |
| LLM fallbacks | Planner → `rulePlan`; brief → `ruleBrief`. **Extraction (`extractEvidence`) and `infer` have no fallback**: a non-budget error is thrown (`research.ts:164, 312-313`). | `plan.ts:66-72`; `strategist.ts:83-89` | PARTIAL |
| Run-level retries | Transient errors (regex on 429, 5xx, timeout, network…) are re-queued from the failed stage after 15 → 30 → 60 minutes with jitter, max 3. Then status `error` plus a `retry_exhausted` review. **Non-transient errors** (e.g. "OpenRouter output invalid after retry") set `pipelineStatus: "error"` with **no review item**. | `orchestrator.ts:52-62, 198-214` | PARTIAL |
| Checkpointing | `pipelineStage` is updated after each completed stage (`orchestrator.ts:160`). Within stage 6, searches are cached per question for 7 days, so a resumed run does not pay again. Evidence inserts check for duplicates. | — | IMPLEMENTED (stage-level) |
| Stuck-job recovery | A run marked `running` whose lock is older than 10 minutes is re-queued from `pipelineStage + 1` (`orchestrator.ts:91-99`, called by `processQueue` at L308). The lock is acquired with a conditional update (L101-107). | — | IMPLEMENTED |
| Serverless time limits | `/api/v1/tick` `maxDuration = 60` s; the queue slice is 30–40 s (`orchestrator.ts:309, 351`); work continues through `kickDrain` (`tick/route.ts:17`). One account's full run can exceed one invocation. Recovery relies on the 10-minute lock expiry. Actual run durations in production are **UNKNOWN**. | — | PARTIAL |
| Budget | Per-tier caps T1 $5, T2 $2, T3 $0.75 (`config.ts:88`). `charge`/`ensureBudget` throw `BudgetExceeded`, which blocks the run and opens a `budget_exceeded` review. The cost figures are estimates (`config.ts:90-100`). | `context.ts:70-91` | IMPLEMENTED |
| Persistence and audit | Every step is written through `logEvent` (run events); plus `ResearchQuery` (query, engine, results, kept), `ResearchPlan`, `Evidence`, `TwinVersion`, `AccountBrief`, `Draft`, decisions and bus events | — | IMPLEMENTED |
| Workflow resumption | Queue (`queuedFromStage`), watchlist re-checks, intent-surge re-runs (`orchestrator.ts:264-295`), `prepareReResearch` | — | IMPLEMENTED |
| Cron | `vercel.json`: `0 2 * * 1-5` (weekdays, once a day) | — | IMPLEMENTED |

---

## I. Identified architectural weaknesses

Each item below is grounded in the code cited; none is a speculative claim about runtime quality.

1. **Shallow research.**
   - One query per question; the first engine with any hit wins; ≤5 pages.
   - The model reads ≤1,800 characters per page.
   - SerpAPI and Tavily provide snippets only.
   - *Refs:* `live/research.ts:61, 90, 104, 138`; `openrouter.ts:96`.
2. **Fixed question breadth.**
   - Research is limited to the pack's 11 questions; T3 gets ≤4, so the deep questions (`erp_program`, `expansion`, `leadership`, `compliance`) are never asked for T3 unless intent is hot or a LinkedIn conversation exists.
   - Nothing discovers opportunities outside these categories during account research. The market scan is a separate prospecting flow.
   - *Refs:* `manch.ts:121-148`; `intake.ts:124-132`.
3. **Keyword-driven search and trigger typing.**
   - Search queries are broad OR-lists; `classifyTrigger` returns the first keyword match.
   - A fact counts as a "trigger" because of the question that found it, not because of what it says.
   - *Refs:* `manch.ts:123`; `seller/fit.ts:109-112`; `research/keys.ts:7-9`.
4. **No business-activity vs buying-intent test.**
   - Any non-negative trigger fact counts toward readiness.
   - Only blockers have a code wording check.
   - *Refs:* `gates.ts:279-288` vs `gates.ts:313-337`.
5. **"Strong evidence" reachable from one article.**
   - 2 probable triggers = strong, with no requirement for different sources or events.
   - One article can yield up to 8 extracted items.
   - *Refs:* `gates.ts:284`; `config.ts:41`; `openrouter.ts:98`.
6. **Weak corroboration grouping.**
   - "Same fact" means the same lower-cased claim text, or the model's `sameAs` choice.
   - Syndicated copies on two hosts count as independent.
   - *Refs:* `research.ts:181-189, 291`; `gates.ts:220-221`.
7. **Claim-to-quote fidelity unchecked at research time.**
   - The quote gate proves the quote exists, not that the model's claim matches it.
   - The entity gate checks the page, not the quoted sentence.
   - *Refs:* `gates.ts:163-191`.
8. **No independent validator.** No component re-reads sources, challenges the brief, or judges completeness. The brief verdict does not gate anything. *Refs:* section E.2.
9. **Premature completion.**
   - Unknowns do not trigger research (only the `trigger` key does).
   - Each of the three loops is capped at one.
   - "No negative news" includes cases where results were filtered out.
   - *Refs:* `research.ts:152-154, 218, 320-322`; `orchestrator.ts:168-175`.
10. **Contradiction detection is narrow.** It covers two keys only; conflicting trigger facts are not detected. *Ref:* `research.ts:246`.
11. **Automatic rejection paths.**
    - Exclusions, targeting rules, fit floor and confirmed blockers disqualify with no review item.
    - Fit can be computed on partial firmographics (`gates.ts:60`; `intake.ts:247`).
    - A wrong `classifySource` "official" label (e.g. a sub-domain page) makes one page enough to disqualify (`gates.ts:292`).
12. **Mixed live/mock configuration.**
    - `createAdapters` starts from mocks and replaces services one by one (`adapters/index.ts:57-66`). Search can be live while the LLM is the mock.
    - The mock `extractEvidence` makes each page title a claim and its first sentence the quote, which passes the quote gate.
    - For negatives, the mock falls back to `"layoffs"` when no kind keyword matches (`mock.ts:348-366`).
    - Whether production ever runs in this state is UNKNOWN.
13. **Unchecked draft assertions.**
    - Only the claims the model lists are fact-checked.
    - Signal labels and why-now text enter the prompt without fact IDs.
    - *Refs:* `outreach.ts:181-183, 225-247`; `openrouter.ts:171`.
14. **Silent hard errors.** Non-transient failures (e.g. invalid model JSON in extraction) end in `pipelineStatus: "error"` without a review item. *Ref:* `orchestrator.ts:209-214`.
15. **Single small model everywhere.** The same model does extraction, interpretation, critique and claim checking of its own output. Any independence comes from different prompts, not a different model. *Ref:* `openrouter.ts:38`.
16. **The third-party intent provider is always the mock.**
    - `createAdapters` never replaces `a.intent` (`adapters/index.ts:57-73`), so `MockIntent` stays in place (`mock.ts:505-527`). It derives a score from a hash of the domain.
    - `processIntent` (`orchestrator.ts:277-295`), which runs on every cron tick (`tick/route.ts:14`), writes that score to `intentScore` for WATCH and RECYCLED accounts.
    - When the score is ≥ 60, it also creates an `intent_surge` signal, which feeds the "third_party" family in the intent score, cancels the watch, and re-runs research.
    - On real accounts these surges are **not based on any real data**.

---

## J. Questions that cannot be answered from static inspection

1. **Configuration in production** (Vercel environment variables):
   - which model is configured (`LLM_MODEL`)
   - which search engines are enabled
   - whether `OPENROUTER_API_KEY` is always present when search keys are
2. **The seller pack in production:** the active autonomy level (`review_all`, `auto_t3` or `auto_all`), and whether the database copy of the Manch pack differs from `src/lib/seller/manch.ts`.
3. **Extraction quality on real pages:**
   - how often the model's claims overstate their quotes
   - how often `sameAs` is set correctly
4. **False-positive / false-negative rates** of `blockerSupported`, `classifyTrigger`, the relevance filter and the entity gate on real data.
5. **Actual search hit rates** per engine and question. They are recorded in `ResearchQuery` in the database but were not read for this audit.
6. **Run durations** in production and how often runs are cut off and recovered.
7. **Real costs vs `CONFIG.costsUsd` estimates**, and whether tier budgets cut research short in practice.
8. **Whether reviewers act on `possible_blocker`, `contradiction` and `no_usable_person` reviews**, and how quickly.
9. **How the market scan's suggestions** (`discover/scan.ts`, ≥2 independent events) perform compared with imported accounts.
10. **How many WATCH accounts have been re-researched** because of mock intent surges (weakness I-16). This needs a database query (`Signal` rows with `type = 'intent_surge'`, `source = 'intent_provider'`).

*End of report. No code, prompts, configuration or data were changed in producing it.*
