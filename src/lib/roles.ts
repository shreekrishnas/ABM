// Per-client roles and what each may do. Checked on the server for every action (via
// logAction in action-utils, which every action calls first) and for Account Brain and
// settings edits. A Super Admin may do everything.

export const ROLES = ["owner", "manager", "rep", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", manager: "Manager", rep: "Rep", viewer: "Viewer" };
export const ROLE_HELP: Record<Role, string> = {
  owner: "Everything in this client, including its Account Brain, settings and who has access",
  manager: "Everything except managing people: import, research, approve companies and emails, settings",
  rep: "Work the pipeline: approve and send emails, LinkedIn, hand-offs, deals, decisions on people",
  viewer: "Read only: sees everything, changes nothing",
};

const RANK: Record<Role, number> = { viewer: 0, rep: 1, manager: 2, owner: 3 };
export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/** The least role an action needs (by the name it is logged under). Unknown actions need Manager. */
const REP_ACTIONS = ["email.", "linkedin.", "decision.", "handoff.decide", "deal.", "fact.flag", "fact.correct", "fact.keep", "fact.check", "research.question", "person.identity", "suggestion.dismiss", "lookalike.reject", "task.", "note."];
const VIEWER_ACTIONS = ["assistant.", "visitors.check_apollo"];
export function minRoleFor(action: string): Role {
  if (VIEWER_ACTIONS.some((p) => action.startsWith(p))) return "viewer";
  if (REP_ACTIONS.some((p) => action.startsWith(p))) return "rep";
  if (action.startsWith("brain.") || action.startsWith("settings.") || action.startsWith("members.")) return "owner";
  return "manager";
}

/** Thrown when someone may not do something. The digest survives Next.js's production error masking so the page can say why. */
export class ActionDenied extends Error {
  digest: string;
  constructor(message: string) {
    super(message);
    this.digest = `ABM_DENIED;${message}`;
  }
}

/** The message carried by an ActionDenied caught in the browser, else null. */
export function deniedMessage(e: unknown): string | null {
  const d = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
  return d.startsWith("ABM_DENIED;") ? d.slice("ABM_DENIED;".length) : null;
}

const VERB: Record<Role, string> = { viewer: "Viewers", rep: "Reps", manager: "Managers", owner: "Owners" };
export function denyText(role: Role, min: Role) {
  return `${VERB[role]} can't do this here; it needs ${ROLE_LABEL[min]} access. Ask an Owner or a Super Admin.`;
}
