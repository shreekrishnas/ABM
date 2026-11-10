"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { loginAction, type LoginState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="lg-btn" disabled={pending}>
      {pending ? <Loader2 size={18} className="lg-spin" /> : <>Continue <ArrowRight size={17} /></>}
    </button>
  );
}

export function LoginForm({ next, domains, ready, byLink, notice }: { next: string; domains: string[]; ready: boolean; byLink: boolean; notice?: string }) {
  const [state, act] = useActionState<LoginState, FormData>(loginAction, {});
  if (state.sent) {
    return (
      <div className="lg-form">
        <div>
          <span className="lg-icon" aria-hidden><Mail size={20} /></span>
          <h2>Check your email</h2>
          <p className="lg-sub">We sent a sign-in link to <b>{state.email}</b>. It works once and expires in 15 minutes. Look in spam if it isn&apos;t there.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="lg-form">
      <form action={act}>
        <span className="lg-icon" aria-hidden><Mail size={20} /></span>
        <h2>Sign in</h2>
        <p className="lg-sub">Use your work email. Only <b>{domains.map((d) => `@${d}`).join(" or ")}</b> addresses can sign in.</p>
        <input type="hidden" name="next" value={next} />
        <label className="lg-field">
          <span>Work email</span>
          <input name="email" type="email" required autoFocus autoComplete="email" placeholder={`you@${domains[0] ?? "company.com"}`} defaultValue={state.email ?? ""} />
        </label>
        {!state.error && notice && <p className="lg-error" role="alert">{notice}</p>}
        {state.error && <p className="lg-error" role="alert">{state.error}</p>}
        {!ready && <p className="lg-error" role="alert">Sign-in isn&apos;t set up yet: add AUTH_SECRET in Vercel.</p>}
        <Submit />
        <p className="lg-fine">{byLink ? "We\u2019ll email you a one-time sign-in link." : "Only people on the Trilliant team list can sign in."}</p>
      </form>
    </div>
  );
}
