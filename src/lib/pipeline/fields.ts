// Field-state helpers. Every important field keeps a status and a source.

import type { FieldStatus } from "@prisma/client";
import { db } from "@/lib/db";

export interface FieldUpdate {
  value?: string | null;
  status: FieldStatus;
  source?: string | null;
  observedAt?: Date | null;
  recheckUsed?: boolean;
}

export async function setContactField(contactId: string, field: string, u: FieldUpdate) {
  await db.fieldState.upsert({
    where: { contactId_field: { contactId, field } },
    create: { contactId, field, value: u.value ?? null, status: u.status, source: u.source ?? null, observedAt: u.observedAt ?? null, recheckUsed: u.recheckUsed ?? false },
    update: { value: u.value ?? undefined, status: u.status, source: u.source ?? undefined, observedAt: u.observedAt ?? undefined, recheckUsed: u.recheckUsed ?? undefined, checkedAt: new Date() },
  });
}

export async function setAccountField(accountId: string, field: string, u: FieldUpdate) {
  await db.fieldState.upsert({
    where: { accountId_field: { accountId, field } },
    create: { accountId, field, value: u.value ?? null, status: u.status, source: u.source ?? null, observedAt: u.observedAt ?? null },
    update: { value: u.value ?? undefined, status: u.status, source: u.source ?? undefined, observedAt: u.observedAt ?? undefined, checkedAt: new Date() },
  });
}

export async function contactFields(contactId: string): Promise<Record<string, { status: FieldStatus; value: string | null; recheckUsed: boolean; observedAt: Date | null; source: string | null }>> {
  const rows = await db.fieldState.findMany({ where: { contactId } });
  return Object.fromEntries(rows.map((r) => [r.field, { status: r.status, value: r.value, recheckUsed: r.recheckUsed, observedAt: r.observedAt, source: r.source }]));
}

export const usable = (s: FieldStatus | undefined) => s === "verified" || s === "probable";
