"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";

const PAGES = new Set(["companies", "people"]);
const PATH: Record<string, string> = { companies: "/accounts", people: "/people" };

/** Save the current filters under a name, for me or for the whole team. */
export async function saveViewAction(page: string, name: string, query: string, shared: boolean): Promise<{ ok: boolean; message: string }> {
  const me = await getMe();
  if (!me) return { ok: false, message: "Sign in first" };
  if (!PAGES.has(page)) return { ok: false, message: "Unknown list" };
  const n = name.trim().slice(0, 60);
  if (!n) return { ok: false, message: "Give the view a name" };
  const q = new URLSearchParams(query);
  for (const k of ["page", "peek", "sel"]) q.delete(k);
  const count = await db.savedView.count({ where: { ownerEmail: me.email, page } });
  if (count >= 30) return { ok: false, message: "You can keep up to 30 views here; delete one first" };
  await db.savedView.create({ data: { ownerEmail: me.email, page, name: n, query: q.toString(), shared } });
  revalidatePath(PATH[page]);
  return { ok: true, message: `Saved "${n}"${shared ? " for the team" : ""}` };
}

export async function deleteViewAction(id: string): Promise<{ ok: boolean; message: string }> {
  const me = await getMe();
  if (!me) return { ok: false, message: "Sign in first" };
  const v = await db.savedView.findUnique({ where: { id } });
  if (!v || (v.ownerEmail !== me.email && !me.superAdmin)) return { ok: false, message: "Only the person who saved it can delete it" };
  await db.savedView.delete({ where: { id } });
  revalidatePath(PATH[v.page] ?? "/");
  return { ok: true, message: "View deleted" };
}
