// Names for the Decision Center filters, shared by server pages and client components (no database
// imports here, so the browser bundle can use them).
export type DecisionFilterKey = "all" | "exception" | "approval";

/** What each filter is called on every screen, and what it holds. */
export const DECISION_FILTER_LABEL: Record<DecisionFilterKey, string> = { all: "All", exception: "Checks", approval: "Sign-offs" };
export const DECISION_FILTER_HELP: Record<DecisionFilterKey, string> = {
  all: "Everything on the Approvals page that only a person can settle",
  exception: "Rule exceptions to check: the right person, conflicting facts, a company to rule out, budget or data problems",
  approval: "Things to sign off: emails to approve, refreshed drafts and replies that need a person",
};

