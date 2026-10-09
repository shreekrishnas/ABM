// Human-readable description of each stage, shown on the pipeline page.
export const STAGE_DOCS: Record<number, { purpose: string; rule: string; trigger: string; output: string }> = {
  1: { purpose: "Accept uploaded or connected data without assuming any of it is correct.", rule: "Nothing is trusted yet. Every field starts as unknown and keeps its source.", trigger: "CSV, CRM form, API", output: "Raw account and contact records" },
  2: { purpose: "Fix obvious data problems before spending money on research or enrichment.", rule: "Duplicates are merged (never deleted) and malformed fields are marked invalid before anything else runs.", trigger: "records.received", output: "One canonical account and person record each" },
  3: { purpose: "Decide which accounts deserve spend — before any paid identity check.", rule: "Customers, competitors, partners, open deals, recent losses and low fit stop here. Unknown firmographics are not scored as bad fit.", trigger: "records.cleaned", output: "Fit, tier, data confidence, intent, research priority" },
  4: { purpose: "Check that email, company, title, phone and LinkedIn belong to the same current person.", rule: "Conflicting fields get one focused re-check; if still conflicting, a person decides.", trigger: "account.prioritized", output: "Field statuses and identity confidence per person" },
  5: { purpose: "Turn gaps into a short list of questions that change a decision.", rule: "If an answer would not change a decision, or is already known and fresh, it is not researched.", trigger: "identity.checked, watchlist re-check, intent surge", output: "Research plan with questions and skipped items" },
  6: { purpose: "Collect source-backed evidence, cheapest strong sources first.", rule: "One main pass and at most one targeted follow-up. No negative news counts as an answer.", trigger: "research.planned", output: "Facts and negative evidence, each with source and date" },
  7: { purpose: "Keep one living view of the account, separating facts from inference.", rule: "An official source wins a contradiction; otherwise the question reopens once, then a person decides.", trigger: "research.done", output: "Versioned twin: facts, inferences, contradictions, unknowns" },
  8: { purpose: "Find people by the problem the account has, not by generic seniority.", rule: "If ownership is unclear, no contacts are guessed.", trigger: "twin.updated", output: "Buying-group map and selected members" },
  9: { purpose: "Fill only missing data, and only for selected people.", rule: "Paid lookups run only for required missing fields, within budget. Suppression and lawful basis are checked here and again before send.", trigger: "buying_group.mapped", output: "Outreach-ready contacts" },
  10: { purpose: "Stop weak intelligence from turning into outbound messages.", rule: "Drafting starts only for people who meet identity and evidence minimums: 1 verified or 2 usable triggers in 90 days.", trigger: "contacts.ready", output: "Ready, re-research, watch, human review or disqualified" },
  11: { purpose: "Draft from the strongest relevant facts, then have a person approve.", rule: "Every claim cites a usable fact; three guardrail failures go to a person. Tier sets the approval policy.", trigger: "readiness.decided", output: "Approved draft with cited evidence" },
  12: { purpose: "Send safely across channels, measure, and score at account level.", rule: "Per-mailbox caps, bounce breaker at 2%, send-once keys. Anonymous activity still moves the account score.", trigger: "draft.approved, engagement events", output: "Sends, signals, replies, buying stage" },
  13: { purpose: "Give a rep a fact-checked briefing when the account engages, then learn from the outcome.", rule: "Automation pauses for the whole account. Lost deals return via the watchlist; weights retune only after enough closed deals.", trigger: "MQA, positive reply, deal closed", output: "Alert, briefing, outcome record" },
};

export const CAT_COLOR: Record<string, string> = {
  data: "#2F6FDB",
  research: "#7A3FD6",
  people: "#0F8A6A",
  outreach: "#C0620A",
  engagement: "#B4235A",
};

/** Where a company is, in plain words (DESIGN.md §6: no internal stage names on screen). */
export const PROGRESS_LABEL: Record<number, string> = {
  0: "Not started", 1: "Imported", 2: "Data cleaned", 3: "Fit checked", 4: "Contacts verified", 5: "Research planned", 6: "Researched",
  7: "Facts confirmed", 8: "Buying group mapped", 9: "Contacts checked", 10: "Ready for outreach", 11: "Emails drafted", 12: "In outreach", 13: "Handed to sales",
};

export const PIPELINE_STATUS_LABEL: Record<string, string> = {
  idle: "paused", queued: "queued", running: "running now", done: "complete", blocked: "waiting on a check", error: "needs attention",
};

/** Short plain names for charts and chips. */
export const STAGE_SHORT: Record<number, string> = {
  1: "Import", 2: "Data cleanup", 3: "Fit check", 4: "Identity check", 5: "Research plan", 6: "Research", 7: "Fact check",
  8: "Buying group", 9: "Contact check", 10: "Readiness", 11: "Writer", 12: "Sending", 13: "Hand-off",
};
