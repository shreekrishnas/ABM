import { redirect } from "next/navigation";
import { ArrowRight, Mail } from "lucide-react";
import { verifyLinkAction } from "../actions";

export const dynamic = "force-dynamic";

/** Landing page for an emailed sign-in link: one button completes the sign-in. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ t?: string; next?: string }> }) {
  const { t, next } = await searchParams;
  if (!t) redirect("/login");
  return (
    <div className="lg-root"><main className="lg-wrap"><section className="lg-card" aria-label="Sign in">
      <div className="lg-form">
        <form action={verifyLinkAction.bind(null, t, next ?? "/")}>
          <span className="lg-icon" aria-hidden><Mail size={20} /></span>
          <h2>Finish signing in</h2>
          <p className="lg-sub">Press the button to sign in on this device.</p>
          <button type="submit" className="lg-btn">Sign in <ArrowRight size={17} /></button>
        </form>
      </div>
    </section></main></div>
  );
}
