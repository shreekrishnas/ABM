"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Mail } from "lucide-react";

// A plain form posting to the sign-in route handler (/login/submit), not a server action: the
// request gate refuses every server action from a signed-out visitor. Errors come back as a short
// code on the address and are worded by the page.

export function LoginForm({ next, domains, ready, byLink, notice, error, email, sent }: { next: string; domains: string[]; ready: boolean; byLink: boolean; notice?: string; error?: string; email?: string; sent?: boolean }) {
  const [pending, setPending] = useState(false);
  if (sent) {
    return (
      <div className="lg-form">
        <div>
          <span className="lg-icon" aria-hidden><Mail size={20} /></span>
          <h2>Check your email</h2>
          <p className="lg-sub">We sent a sign-in link to <b>{email}</b>. It works once and expires in 15 minutes. Look in spam if it isn&apos;t there.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="lg-form">
      <form method="post" action="/login/submit" onSubmit={() => setPending(true)}>
        <span className="lg-icon" aria-hidden><Mail size={20} /></span>
        <h2>Sign in</h2>
        <p className="lg-sub">Use your work email. Only <b>{domains.map((d) => `@${d}`).join(" or ")}</b> addresses can sign in.</p>
        <input type="hidden" name="next" value={next} />
        <label className="lg-field">
          <span>Work email</span>
          <input name="email" type="email" required autoFocus autoComplete="email" placeholder={`you@${domains[0] ?? "company.com"}`} defaultValue={email ?? ""} />
        </label>
        {!error && notice && <p className="lg-error" role="alert">{notice}</p>}
        {error && <p className="lg-error" role="alert">{error}</p>}
        {!ready && <p className="lg-error" role="alert">Sign-in isn&apos;t set up yet: add AUTH_SECRET in Vercel.</p>}
        <button type="submit" className="lg-btn" disabled={pending}>
          {pending ? <Loader2 size={18} className="lg-spin" /> : <>Continue <ArrowRight size={17} /></>}
        </button>
        <p className="lg-fine">{byLink ? "We’ll email you a one-time sign-in link." : "Only people on the Trilliant team list can sign in."}</p>
      </form>
    </div>
  );
}
