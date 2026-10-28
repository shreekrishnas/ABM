import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { ActionForm, Modal, SubmitButton } from "@/components/client";
import { FormField } from "@/components/kit";
import { createAccountAction } from "../actions";

/** Add one company by hand; every field starts as unknown and keeps its source until verified. */
export async function NewCompany() {
  const users = await db.user.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <Modal trigger={<><Plus size={16} /> New company</>} title="Add a company" eyebrow="Companies" triggerClass="btn btn-primary">
      <ActionForm action={createAccountAction} className="grid gap-3">
        <FormField label="Company name" required><input name="name" required className="glass-input" placeholder="Northwind Analytics" /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Website"><input name="domain" className="glass-input" placeholder="northwind.com" /></FormField>
          <FormField label="Industry"><input name="industry" className="glass-input" placeholder="analytics" /></FormField>
          <FormField label="Employees"><input name="employees" className="glass-input" inputMode="numeric" placeholder="850" /></FormField>
          <FormField label="Country (2 letters)"><input name="country" className="glass-input" placeholder="IN" maxLength={2} /></FormField>
        </div>
        <FormField label="Owner"><select name="ownerId" className="glass-select"><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></FormField>
        <p className="muted text-xs">Every field starts as unknown and keeps its source until the pipeline verifies it.</p>
        <div className="mt-1 flex justify-end"><SubmitButton className="btn btn-primary">Create company</SubmitButton></div>
      </ActionForm>
    </Modal>
  );
}
