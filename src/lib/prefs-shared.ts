// Preference choices, safe to use in the browser (no database code).
export const HOMES = [
  { value: "/", label: "Home" },
  { value: "/work/today", label: "Today" },
  { value: "/review", label: "Approvals" },
  { value: "/accounts", label: "Companies" },
] as const;
export const NOTICE_KINDS = [
  { key: "reply", label: "Replies" },
  { key: "approval", label: "Approvals waiting" },
  { key: "handoff", label: "Hand-offs" },
  { key: "task", label: "Overdue tasks" },
  { key: "visitor", label: "Website visitors" },
  { key: "system", label: "System, spending and security (Super Admin)" },
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number]["key"];

