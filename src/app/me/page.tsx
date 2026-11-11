import { notFound } from "next/navigation";
import { getMe } from "@/lib/me";
import { db } from "@/lib/db";
import { prefsFor, landingFor } from "@/lib/prefs";
import { ROLE_LABEL } from "@/lib/roles";
import { ActionButton } from "@/components/client";
import { Card, PageHeader, ago } from "@/components/ui";
import { ProfileForm } from "./form";
import { ThemeChoice } from "./theme";
import { signOutOtherDevicesAction } from "./actions";

export const metadata = { title: "My settings" };
export const dynamic = "force-dynamic";

/** Personal settings: name, where to land, notifications, theme, clients and sign-ins. */
export default async function MyPage() {
  const me = await getMe();
  if (!me) notFound();
  const [prefs, signIns] = await Promise.all([
    prefsFor(me.email),
    db.signInEvent.findMany({ where: { email: me.email }, orderBy: { createdAt: "desc" }, take: 8 }).catch(() => []),
  ]);
  return (
    <div className="page-enter space-y-5 me-page">
      <PageHeader title="My settings" sub={me.email} />
      <Card title="Profile and notifications"><ProfileForm name={me.name} home={landingFor(prefs)} mute={prefs.mute ?? []} superAdmin={me.canSuperAdmin} /></Card>
      <Card title="Theme" sub="Kept in this browser"><ThemeChoice /></Card>
      <Card title="Your clients" sub="What you can see and do in each. Ask a Super Admin to change it." pad={false}>
        {me.clients.length === 0 ? <p className="muted so-pad text-sm">{me.canSuperAdmin ? "As a Super Admin you can open every client." : "No client assigned yet."}</p> : (
          <table className="data compact"><tbody>{me.clients.map((c) => <tr key={c.id}><td className="strong">{c.name}</td><td>{ROLE_LABEL[c.role]}</td></tr>)}</tbody></table>
        )}
      </Card>
      <Card title="Recent sign-ins" pad={false}>
        {signIns.length === 0 ? <p className="muted so-pad text-sm">None recorded yet.</p> : (
          <table className="data compact"><tbody>{signIns.map((s) => <tr key={s.id}><td className="muted">{ago(s.createdAt)}</td><td>{s.ok ? "Signed in" : `Failed: ${s.reason ?? ""}`}</td><td className="muted mono text-xs">{s.ip ?? ""}</td></tr>)}</tbody></table>
        )}
        <div className="so-pad"><ActionButton action={signOutOtherDevicesAction} className="btn btn-secondary btn-sm" confirm="Sign out on every other device? This one stays signed in.">Sign out other devices</ActionButton></div>
      </Card>
    </div>
  );
}
