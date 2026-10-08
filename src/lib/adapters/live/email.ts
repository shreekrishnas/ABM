// Email channel, live parts. Email is the only outbound channel for now; everything
// sits behind the EmailSender / MailboxVerifier / DataProvider interfaces so LinkedIn
// can plug in later without touching the core.

import { promises as dns } from "node:dns";
import type { DataProvider, EmailSender, MailboxVerifier, ProviderPerson } from "../types";

/** No people-data provider connected: never invent people or emails on real companies. */
export class NoProvider implements DataProvider {
  readonly name = "none";
  async lookupPerson(): Promise<ProviderPerson | null> {
    return null;
  }
  async recheckPerson(): Promise<ProviderPerson | null> {
    return null;
  }
  async findByFunction(): Promise<ProviderPerson[]> {
    return [];
  }
  async findEmail(): Promise<string | null> {
    return null;
  }
}

/**
 * Free contact verifier: the address is well-formed and its domain accepts email (MX).
 * That proves the domain, not the mailbox, so a pass is "probable", never "verified".
 */
export class MxVerifier implements MailboxVerifier {
  private cache = new Map<string, string[]>();
  async verify(email: string): Promise<{ deliverable: boolean; reason: string; status: "probable" | "invalid" }> {
    const m = email.trim().toLowerCase().match(/^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/);
    if (!m) return { deliverable: false, reason: "Not a valid email address", status: "invalid" };
    const domain = m[1];
    let mx = this.cache.get(domain);
    if (!mx) {
      try {
        mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
      } catch (e) {
        const code = (e as { code?: string }).code;
        // A DNS outage is not proof the address is bad: treat it as unknown, not invalid.
        if (code !== "ENOTFOUND" && code !== "ENODATA") throw new Error(`MX lookup failed for ${domain}: ${code ?? e}`);
        mx = [];
      }
      this.cache.set(domain, mx);
    }
    if (!mx.length) return { deliverable: false, reason: `${domain} has no mail server (no MX record)`, status: "invalid" };
    return { deliverable: true, reason: `${domain} accepts email (${mx[0]}); mailbox itself not confirmed`, status: "probable" };
  }
}

/** Real sending over SMTP (Google Workspace, Microsoft 365, or any SMTP relay). */
export class SmtpSender implements EmailSender {
  readonly connected = true;
  constructor(private url: string, private fromOverride?: string) {}
  async send(msg: { from: string; to: string; subject: string; body: string; idempotencyKey: string }) {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(this.url);
    const r = await transport.sendMail({ from: this.fromOverride || msg.from, to: msg.to, subject: msg.subject, text: msg.body, messageId: `<${msg.idempotencyKey}@abm.local>`, headers: { "X-ABM-Draft": msg.idempotencyKey } });
    return { providerId: r.messageId };
  }
}

/** No mailbox connected: the channel refuses to send (safer than pretending). */
export class DisconnectedSender implements EmailSender {
  readonly connected = false;
  async send(): Promise<{ providerId: string }> {
    throw new Error("No mailbox connected — set SMTP_URL to send email");
  }
}
