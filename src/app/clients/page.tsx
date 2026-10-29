import { ArrowRight, Building2, Check, ShieldAlert } from "lucide-react";
import { resolveScope } from "@/lib/scope";
import { accountCards } from "@/lib/clients";
import { switchClientAction } from "../login/actions";
import { EmptyState } from "@/components/kit";
import { AccountLogo } from "@/components/account-logo";
import { AccountSearch } from "./search";

export const metadata = { title: "Accounts" };

/** Every client account this person can open, one card each. Opening one makes it the active workspace. */
export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const scope = await resolveScope();
  const cards = await accountCards(scope);
  const active = scope?.active && scope.ids?.length === 1 ? scope.active : null;

  return (
    <div className="page-enter ac">
      <header className="ac-head">
        <div className="min-w-0">
          <h1>Accounts</h1>
          <p>{cards.length === 1 ? "The account you work on." : `${cards.length} accounts you work on. Each one is its own workspace: its companies, people, emails and reports stay inside it.`}</p>
        </div>
        {cards.length > 1 && (
          <form action={switchClientAction.bind(null, "all", "/")}>
            <button type="submit" className={`btn btn-secondary${active ? "" : " ac-all-on"}`}>{active ? "View all my accounts together" : <><Check size={15} /> Viewing all my accounts</>}</button>
          </form>
        )}
      </header>

      {denied && (
        <div className="ac-denied" role="alert"><ShieldAlert size={16} aria-hidden /> You don&apos;t have access to that account. Ask a Super Admin to add you to it.</div>
      )}

      {cards.length === 0 ? (
        <EmptyState icon={<Building2 size={20} />} title="No accounts yet" text="You haven't been added to an account. Ask a Super Admin to add you in Team & Access." />
      ) : (
        <AccountSearch total={cards.length}>
          {cards.map((c) => (
            <li key={c.id} className={`ac-card${active === c.id ? " on" : ""}`} data-name={c.name.toLowerCase()}>
              <div className="ac-top">
                <AccountLogo name={c.name} url={c.logoUrl} className="ac-av" />
                <div className="min-w-0">
                  <h2>{c.name}</h2>
                  {active === c.id && <span className="ac-badge">Open now</span>}
                </div>
              </div>
              <p className="ac-desc">{c.description ?? "No description yet. Add one in the Account Brain."}</p>
              <div className="ac-foot">
                                <form action={switchClientAction.bind(null, c.id, "/")}>
                  <button type="submit" className="btn btn-primary btn-sm">{active === c.id ? "Go to dashboard" : "Open account"} <ArrowRight size={14} /></button>
                </form>
              </div>
            </li>
          ))}
        </AccountSearch>
      )}
    </div>
  );
}
