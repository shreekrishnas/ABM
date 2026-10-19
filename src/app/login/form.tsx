"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { loginAction, type LoginState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="lg-btn" disabled={pending}>
      {pending ? <Loader2 size={18} className="lg-spin" /> : <>Sign in <ArrowRight size={17} /></>}
    </button>
  );
}

export function LoginForm({ next, domains, ready }: { next: string; domains: string[]; ready: boolean }) {
  const [state, act] = useActionState<LoginState, FormData>(loginAction, {});
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
        {state.error && <p className="lg-error" role="alert">{state.error}</p>}
        {!ready && <p className="lg-error" role="alert">Sign-in isn&apos;t set up yet: add AUTH_SECRET in Vercel.</p>}
        <Submit />
        <p className="lg-fine">Only people on the Trilliant team list can sign in.</p>
      </form>
    </div>
  );
}
