"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import { loginAction, type LoginState } from "./actions";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="lg-btn" disabled={pending}>
      {pending ? <Loader2 size={18} className="lg-spin" /> : children}
    </button>
  );
}

function CodeBoxes() {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => refs.current[0]?.focus(), []);
  const set = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      const next = [...digits];
      clean.slice(0, 6 - i).split("").forEach((c, k) => (next[i + k] = c));
      setDigits(next);
      refs.current[Math.min(5, i + clean.length)]?.focus();
      if (next.every(Boolean)) refs.current[5]?.form?.requestSubmit();
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
    if (next.every(Boolean)) refs.current[i]?.form?.requestSubmit();
  };
  return (
    <div className="lg-code" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={6}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus(); }}
        />
      ))}
      <input type="hidden" name="code" value={digits.join("")} />
    </div>
  );
}

export function LoginForm({ next, domains, codes, ready }: { next: string; domains: string[]; codes: boolean; ready: boolean }) {
  const [state, act] = useActionState<LoginState, FormData>(loginAction, { step: "email" });
  const email = state.email ?? "";

  return (
    <div className="lg-form" key={state.step}>
      {state.step === "code" ? (
        <form action={act}>
          <span className="lg-icon" aria-hidden><Lock size={20} /></span>
          <h2>Check your inbox</h2>
          <p className="lg-sub">Enter the 6-digit code we sent to <b>{email}</b>. It works for 10 minutes.</p>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="intent" value="verify" />
          <CodeBoxes />
          {state.error && <p className="lg-error" role="alert">{state.error}</p>}
          <Submit>Sign in <ArrowRight size={17} /></Submit>
          <button type="submit" name="intent" value="reset" formNoValidate className="lg-link"><ArrowLeft size={14} /> Use a different email</button>
        </form>
      ) : (
        <form action={act}>
          <span className="lg-icon" aria-hidden><Mail size={20} /></span>
          <h2>Sign in</h2>
          <p className="lg-sub">Use your work email. Only <b>{domains.map((d) => `@${d}`).join(" or ")}</b> addresses can sign in.</p>
          <input type="hidden" name="next" value={next} />
          <label className="lg-field">
            <span>Work email</span>
            <input name="email" type="email" required autoFocus autoComplete="email" placeholder={`you@${domains[0] ?? "company.com"}`} defaultValue={email} />
          </label>
          {state.error && <p className="lg-error" role="alert">{state.error}</p>}
          {!ready && <p className="lg-error" role="alert">Sign-in isn&apos;t set up yet: add AUTH_SECRET in Vercel.</p>}
          <Submit>{codes ? "Email me a code" : "Continue"} <ArrowRight size={17} /></Submit>
          <p className="lg-fine">{codes ? "We'll email a one-time code. No password needed." : "Access is limited to your company's email domain."}</p>
        </form>
      )}
    </div>
  );
}
