// Can this client's approved emails go out? One checklist per client, built from what the send step
// actually requires: the send step holds a client's emails with the exact missing items, and Settings
// and System health show the same list with how to fix each. Read-only: nothing is sent or changed.

import { baseDb } from "@/lib/db-base";

export interface ReadinessItem {
  key: "connection" | "mailbox" | "brain" | "sender" | "postal_address" | "client_active" | "bounce_breaker" | "sequence" | "approval" | "ai";
  label: string;
  ok: boolean;
  /** Stops emails going out when not ok (the others are information). */
  blocking: boolean;
  /** What is missing, in plain words (only when not ok, or for information). */
  detail?: string;
  /** How to fix it, and where. */
  fix?: string;
  href?: string;
}

export interface EmailReadiness {
  clientId: string;
  ready: boolean;
  items: ReadinessItem[];
  /** The blocking items not done, as short phrases (for the send step's reason). */
  missing: string[];
}

const env = (k: string) => process.env[k]?.trim() || "";

export async function emailReadiness(clientId: string): Promise<EmailReadiness> {
  const { ensureSellerPacks, sellerFor } = await import("@/lib/seller");
  await ensureSellerPacks();
  let pack: import("@/lib/seller").SellerProfile | null = null;
  try {
    pack = sellerFor(clientId);
  } catch {
    pack = null;
  }
  const [client, mailboxes, breaker, sequences, paused] = await Promise.all([
    baseDb.client.findUnique({ where: { id: clientId }, select: { status: true, name: true } }),
    baseDb.mailbox.count({ where: { active: true, warmedUp: true, dailyCap: { gt: 0 } } }),
    baseDb.reviewItem.findFirst({ where: { type: "bounce_breaker", status: "open" }, select: { reason: true } }),
    baseDb.sequence.count({ where: { steps: { some: { channel: "email" } } } }),
    import("@/lib/admin/ai-pause").then((m) => m.aiPause()).catch(() => null),
  ]);
  const sample = env("ADAPTER_MODE") === "mock";
  const items: ReadinessItem[] = [
    {
      key: "connection", label: "Mailbox connection (SMTP)", blocking: true, ok: sample || Boolean(env("SMTP_URL")),
      detail: sample ? "Sample mode: emails are recorded, not sent" : env("SMTP_URL") ? undefined : "Email sending is not available yet",
      fix: "Not available yet",
    },
    {
      key: "mailbox", label: "A sending mailbox with a daily limit", blocking: true, ok: mailboxes > 0,
      detail: mailboxes ? `${mailboxes} active` : "No active mailbox: every approved email would be held at the daily-limit check",
      fix: "Not available yet",
    },
    {
      key: "brain", label: "Account Brain finished", blocking: true, ok: Boolean(pack),
      detail: pack ? undefined : "Emails are written and checked against the client's Account Brain",
      fix: "Finish the Account Brain", href: "/brain",
    },
    {
      key: "sender", label: "Sender name and company", blocking: true, ok: Boolean(pack?.sender.name.trim() && pack.sender.company.trim()),
      detail: pack && !(pack.sender.name.trim() && pack.sender.company.trim()) ? "Every email is signed with them" : undefined,
      fix: "Add them in the Account Brain → Sender", href: "/brain",
    },
    {
      key: "postal_address", label: "Registered postal address", blocking: true, ok: Boolean(pack?.sender.address.trim()),
      detail: pack?.sender.address.trim() ? undefined : "Required in every email's footer; emails without it are stopped by the compliance check",
      fix: "Add the registered postal address in the Account Brain → Sender", href: "/brain",
    },
    {
      // As the send step does: only a client that exists and is paused or archived is stopped.
      key: "client_active", label: "Client active", blocking: true, ok: !client || client.status === "active",
      detail: client && client.status !== "active" ? `The client is ${client.status}: research and sending are stopped` : undefined,
      fix: "Not available while the client is paused",
    },
    {
      key: "bounce_breaker", label: "Sending not paused for bounces", blocking: true, ok: !breaker,
      detail: breaker ? breaker.reason.slice(0, 200) : undefined,
      fix: "Check the mailbox and the addresses that bounced; resolve the item in Approvals", href: "/review?type=bounce_breaker",
    },
    {
      key: "sequence", label: "An email sequence", blocking: true, ok: sequences > 0,
      detail: sequences ? undefined : "Companies are enrolled in a sequence before any email is drafted",
      fix: "Add an email sequence", href: "/settings#scoring",
    },
    {
      key: "approval", label: "Approval rule", blocking: false, ok: true,
      detail: { review_all: "A person approves every email before it goes out", auto_t3: "Broad-priority emails that pass every check go out; the rest are approved by a person", auto_all: "Emails that pass every check go out without a person" }[pack?.autonomy ?? "review_all"],
    },
    {
      key: "ai", label: "AI drafting", blocking: false, ok: !paused,
      detail: paused ? "AI is paused: no new emails are drafted; approved ones can still go out" : undefined,
      fix: paused ? "Resume AI in System health when you're ready" : undefined, href: paused ? "/team?tab=system" : undefined,
    },
  ];
  const missing = items.filter((i) => i.blocking && !i.ok).map((i) => i.label.toLowerCase());
  return { clientId, ready: missing.length === 0, items, missing };
}
