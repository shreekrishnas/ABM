import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus, Search, Trash2, Users } from "lucide-react";
import { db } from "@/lib/db";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/client";
import { Avatar, Badge, Card, Empty, FieldBadge, PageHeader, ago, cx } from "@/components/ui";
import { createContactAction, eraseContactAction } from "../../actions";

export const metadata = { title: "CRM · Contacts" };

const STATES = ["new", "selected", "ready", "in_sequence", "paused", "replied", "handed_off", "suppressed", "do_not_contact"] as const;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  const sp = await searchParams;
  const where: Prisma.ContactWhereInput = {
    mergedIntoId: null,
    ...(sp.q ? { OR: [{ fullName: { contains: sp.q, mode: "insensitive" } }, { email: { contains: sp.q, mode: "insensitive" } }, { titleNormalized: { contains: sp.q, mode: "insensitive" } }, { account: { name: { contains: sp.q, mode: "insensitive" } } }] } : {}),
    ...(sp.state && (STATES as readonly string[]).includes(sp.state) ? { state: sp.state as (typeof STATES)[number] } : {}),
  };
  const [contacts, accounts, total] = await Promise.all([
    db.contact.findMany({ where, include: { account: true, fieldStates: { where: { field: "email" } } }, orderBy: { updatedAt: "desc" }, take: 200 }),
    db.account.findMany({ where: { mergedIntoId: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.contact.count({ where: { mergedIntoId: null } }),
  ]);

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="CRM"
        title="Contacts"
        sub={`${total} people across all accounts. New contacts start unverified and go through identity checks on the next pipeline run.`}
        actions={
          <Modal trigger={<><Plus size={16} /> New contact</>} title="Add a contact" eyebrow="CRM" triggerClass="btn btn-brand">
            {() => (
              <ActionForm action={createContactAction} className="grid gap-3">
                <div><label className="field-label" htmlFor="ca">Account</label><select id="ca" name="accountId" required className="glass-select" defaultValue=""><option value="" disabled>Choose an account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                <div><label className="field-label" htmlFor="cn">Full name</label><input id="cn" name="fullName" required className="glass-input" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="field-label" htmlFor="ct">Title</label><input id="ct" name="title" className="glass-input" /></div>
                  <div><label className="field-label" htmlFor="ce">Email</label><input id="ce" name="email" type="email" className="glass-input" /></div>
                  <div><label className="field-label" htmlFor="cp">Phone</label><input id="cp" name="phone" className="glass-input" placeholder="+1 415 555 0100" /></div>
                  <div><label className="field-label" htmlFor="cl">LinkedIn URL</label><input id="cl" name="linkedinUrl" className="glass-input" /></div>
                </div>
                <div className="flex justify-end"><SubmitButton>Add contact</SubmitButton></div>
              </ActionForm>
            )}
          </Modal>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form className="search-pill w-full max-w-sm" action="/crm/contacts">
          <Search size={16} />
          <input name="q" defaultValue={sp.q} className="glass-input" placeholder="Search name, email, title, account" aria-label="Search contacts" />
        </form>
        <div className="segmented flex-wrap">
          <Link href="/crm/contacts" className={cx(!sp.state && "on")}>All</Link>
          {["ready", "in_sequence", "handed_off", "suppressed"].map((s) => <Link key={s} href={`/crm/contacts?state=${s}`} className={cx(sp.state === s && "on")}>{s.replace("_", " ")}</Link>)}
        </div>
      </div>
      <Card pad={false}>
        {contacts.length === 0 ? <Empty icon={<Users size={20} />} title="No contacts found" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Name</th><th>Account</th><th>Role</th><th>Email</th><th>State</th><th>Source</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td className="strong"><div className="flex items-center gap-2.5"><Avatar name={c.fullName} id={c.id} size={30} round /><div>{c.fullName}<div className="muted text-xs font-normal">{c.titleNormalized ?? c.title ?? "—"}</div></div></div></td>
                    <td><Link href={`/accounts/${c.accountId}?tab=people`} className="hover:underline">{c.account.name}</Link></td>
                    <td><Badge color={c.buyingRole === "decision_maker" ? "#4F46E5" : c.buyingRole === "champion" ? "#0D9488" : "#64748B"}>{c.buyingRole.replace("_", " ")}</Badge></td>
                    <td><div className="mono text-xs">{c.email ?? "—"}</div><FieldBadge status={c.fieldStates[0]?.status} /></td>
                    <td className="text-xs">{c.state.replaceAll("_", " ")}</td>
                    <td className="muted text-xs">{c.source}</td>
                    <td className="muted whitespace-nowrap text-xs">{ago(c.updatedAt)}</td>
                    <td><ActionButton action={eraseContactAction.bind(null, c.id)} className="btn btn-icon" confirm={`Erase ${c.fullName}? Personal data is deleted permanently and a hashed suppression is kept (GDPR erasure).`} title="GDPR erase"><Trash2 size={15} /></ActionButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
