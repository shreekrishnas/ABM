# Import → research stream

What happens between a CSV upload and the research that feeds the AI brief. Visible per company on
**Companies → (company) → Data → research**, and summarised on the import's finished screen.

| Step | What runs | Code |
|---|---|---|
| 1. Intake map | Every company field with its value, source (import file, or `research: <url>`) and status (unverified / probable / verified / missing). Website, industry, size and country are the critical fields. | `intakeMap` in `src/lib/research/intake.ts` |
| 2. Gap fill (stage 2b) | Before fit and identity: if the website is missing, one search finds the official site (directories, LinkedIn and news sites are rejected; the site's address must carry the company's brand). If industry, size or country is missing, one search reads a company profile. Filled values are marked `probable` with the source page. Imported values are never overwritten. A website that already belongs to another company goes to the Review queue. | `fillGaps`, `pickOfficialSite` |
| 3. What the import already answered | Imported technologies → the "Systems in use" question is not searched (saves a paid search). Keywords → added to the trigger and expansion searches. Company notes → given to the AI brief. | `s05ResearchPlan`, `rulePlan`, OpenRouter prompts |
| 4. Depth | Deep dive (adds ERP/MDM programme, expansion, leadership change, compliance) for T1 companies and for any company where someone has replied on LinkedIn; T2 gets the two strongest deep questions; T3 the core questions. ERP programme, expansion and leadership answers count as buying triggers. | `researchDepth`, `TRIGGER_KEYS` |
| 5. Conversations → brief | LinkedIn replies from the import are passed to the AI brief; if a conversation is running, the next best action builds on it instead of a cold email. | `importContext`, `buildBrief`, `ruleBrief` |

Gap-fill searches use the same cache, budget and engine logging as all research; a search outage or
budget cap never stops the company's run (fit is scored on the fields that are known).
