import { redirect } from "next/navigation";
import { ArrowRight, Mail } from "lucide-react";

export const dynamic = "force-dynamic";

/** Landing page for an emailed sign-in link: one button completes the sign-in. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ t?: string; next?: string }> }) {
  const { t, next } = await searchParams;
  if (!t) redirect("/login");
  return (
    <div className="lg-root"><main className="lg-wrap"><section className="lg-card" aria-label="Sign in">
      <div className="lg-form">
        {/* Posts to the sign-in route handler (not a server action: signed-out visitors may not call those). */}
        <form method="post" action="/login/verify/submit">
          <input type="hidden" name="t" value={t} />
          <input type="hidden" name="next" value={next ?? "/"} />
          <span className="lg-icon" aria-hidden><Mail size={20} /></span>
          <h2>Finish signing in</h2>
          <p className="lg-sub">Press the button to sign in on this device.</p>
          <button type="submit" className="lg-btn">Sign in <ArrowRight size={17} /></button>
        </form>
      </div>
    </section></main></div>
  );
}
