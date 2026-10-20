"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { authRequired } from "@/lib/auth";
import { getMe } from "@/lib/me";
import { getAdapters } from "@/lib/adapters";
import { addDocument, deleteDocument } from "@/lib/knowledge/rag/store";
import { loadBrain, readSection, saveBrain, sectionByKey, writeSection, type BrainItem } from "@/lib/seller/brain";

export type BrainState = { ok: boolean; message: string } | null;

/** Anyone assigned to the account (or Super Admin) may change its brain. */
async function editor(clientId: string): Promise<string> {
  const me = await getMe();
  if (!me) {
    if (authRequired()) throw new Error("Sign in first");
    return "local";
  }
  if (!me.superAdmin && !me.clients.some((c) => c.id === clientId)) throw new Error("You are not assigned to this account");
  return me.email;
}

const done = (clientId: string) => {
  revalidatePath("/brain");
  revalidatePath(`/brain?client=${clientId}`);
};

export async function saveBrainSectionAction(clientId: string, sectionKey: string, items: BrainItem[]): Promise<BrainState> {
  try {
    const who = await editor(clientId);
    const section = sectionByKey(sectionKey);
    if (!section) return { ok: false, message: "Unknown section" };
    if (items.length > 200) return { ok: false, message: "Too many items in one section (200 max)" };
    const { pack } = await loadBrain(clientId);
    const r = await saveBrain(clientId, writeSection(pack, sectionKey, items), `${section.label} edited by ${who}`);
    if (!r.ok) return { ok: false, message: r.message };
    done(clientId);
    return { ok: true, message: r.ready ? `${section.label} saved. New research uses it now.` : `${section.label} saved as a draft. Fill the missing parts to start research.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't save" };
  }
}

/** AI fill: suggestions for one section from the account's website and files. Nothing is saved until a person accepts. */
export async function suggestBrainAction(clientId: string, sectionKey: string): Promise<{ ok: true; items: BrainItem[] } | { ok: false; message: string }> {
  try {
    await editor(clientId);
    const section = sectionByKey(sectionKey);
    if (!section) return { ok: false, message: "Unknown section" };
    const { pack } = await loadBrain(clientId);
    const a = getAdapters();
    const docs = await db.knowledgeDoc.findMany({ where: { sellerId: clientId, origin: "upload" }, orderBy: { createdAt: "desc" }, take: 6, select: { title: true, text: true, url: true } });
    let pages: { title: string; url: string | null; text: string }[] = [];
    const domain = pack.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (pack.name) {
      try {
        pages = (await a.research.search(domain, pack.name, "brain", "main", { query: `${pack.name}${domain ? ` site:${domain}` : ""} ${section.label}` })).slice(0, 5).map((p) => ({ title: p.title, url: p.url, text: p.text }));
      } catch {
        // No search connected: files alone are used.
      }
    }
    const context = [...docs.map((d) => ({ title: d.title, url: d.url, text: d.text })), ...pages];
    if (!context.length) return { ok: false, message: "Nothing to read yet: add the account's website in Overview, or upload a file below" };
    const existing = readSection(pack, sectionKey).map((it) => Object.values(it).filter((v) => typeof v === "string").slice(0, 2).join(" — ")).filter(Boolean);
    const raw = await a.llm.suggestBrainItems({
      account: pack.name || clientId, section: section.label, ask: section.aiAsk, single: Boolean(section.single), existing, context,
      fields: section.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, options: f.options?.map((o) => o.value) })),
    });
    const items: BrainItem[] = raw.map((r) => Object.fromEntries(section.fields.map((f) => {
      const v = (r[f.key] ?? "").toString().trim();
      return [f.key, f.kind === "lines" ? v.split(/\n|;\s*/).map((x) => x.trim()).filter(Boolean) : f.kind === "list" ? v.split(",").map((x) => x.trim()).filter(Boolean) : f.kind === "bool" ? v === "true" : f.kind === "number" ? (Number.isFinite(Number(v)) && v ? Math.round(Number(v)) : null) : v];
    })) as BrainItem);
    if (!items.length) return { ok: false, message: "The AI found nothing new for this section in the website or files" };
    return { ok: true, items };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 200) : "AI fill failed" };
  }
}

async function fileText(f: File): Promise<string> {
  const name = f.name.toLowerCase();
  const buf = new Uint8Array(await f.arrayBuffer());
  if (name.endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: Buffer.from(buf) })).value;
  }
  return new TextDecoder().decode(buf);
}

export async function addBrainFileAction(clientId: string, _: BrainState, fd: FormData): Promise<BrainState> {
  try {
    await editor(clientId);
    const file = fd.get("file");
    const pasted = String(fd.get("text") ?? "").trim();
    let title = String(fd.get("title") ?? "").trim();
    let text = pasted;
    if (file instanceof File && file.size > 0) {
      if (file.size > 15_000_000) return { ok: false, message: "That file is over 15 MB" };
      if (!/\.(pdf|docx|txt|md|csv|html?)$/i.test(file.name)) return { ok: false, message: "Use a PDF, Word (.docx), text, Markdown, CSV or HTML file" };
      text = (await fileText(file)).replace(/\s+\n/g, "\n").trim();
      title ||= file.name;
    }
    if (text.length < 40) return { ok: false, message: "Upload a file or paste at least a paragraph" };
    const r = await addDocument({ sellerId: clientId, title: (title || "Notes").slice(0, 160), text: text.slice(0, 300_000), kind: "document", approved: fd.get("approved") === "on", url: null });
    done(clientId);
    return { ok: true, message: `Added "${title || "Notes"}" (${r.chunks} part${r.chunks === 1 ? "" : "s"}). AI fill and the writer can use it now.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 200) : "Couldn't add the file" };
  }
}

export async function removeBrainFileAction(clientId: string, docId: string): Promise<BrainState> {
  try {
    await editor(clientId);
    const doc = await db.knowledgeDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.sellerId !== clientId) return { ok: false, message: "File not found" };
    await deleteDocument(docId);
    done(clientId);
    return { ok: true, message: `Removed "${doc.title}"` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't remove it" };
  }
}

/** Optional rough estimate: saved rule vs edited rule, over companies already in the app with known country and size. */
export async function estimateTargetingAction(clientId: string, item: BrainItem): Promise<{ ok: true; now: number; next: number; total: number } | { ok: false; message: string }> {
  try {
    await editor(clientId);
    const { pack } = await loadBrain(clientId);
    const edited = writeSection(pack, "targeting", [item]).icp.mustHave;
    const { mustHaveGate } = await import("@/lib/pipeline/gates");
    const { normalizeCountry } = await import("@/lib/pipeline/normalize");
    const rows = await db.account.findMany({ where: { mergedIntoId: null, country: { not: null }, employees: { not: null } }, select: { country: true, employees: true }, take: 20000 });
    let now = 0, next = 0;
    for (const a of rows) {
      const c = { country: normalizeCountry(a.country), employees: a.employees };
      if (mustHaveGate(c, pack.icp.mustHave).pass) now++;
      if (mustHaveGate(c, edited).pass) next++;
    }
    return { ok: true, now, next, total: rows.length };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not estimate" };
  }
}
