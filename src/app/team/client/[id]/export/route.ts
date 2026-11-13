import JSZip from "jszip";
import { baseDb } from "@/lib/db-base";
import { audit, coversClient, getMe } from "@/lib/me";

// One client's data as a .zip of CSV files plus its Account Brain. Super Admin only; reads only
// rows that belong to this client.
export const maxDuration = 60;

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  const { id } = await params;
  if (!me || !coversClient(me, id)) return new Response("Not found", { status: 404 });
  const client = await baseDb.client.findUnique({ where: { id } });
  if (!client) return new Response("Not found", { status: 404 });

  const own = { sellerId: id };
  const viaAccount = { account: own };
  const viaContact = { contact: { account: own } };
  const [companies, people, facts, emails, replies, deals, tasks, notes, brain] = await Promise.all([
    baseDb.account.findMany({ where: own, orderBy: { name: "asc" } }),
    baseDb.contact.findMany({ where: viaAccount, orderBy: { fullName: "asc" } }),
    baseDb.evidence.findMany({ where: viaAccount }),
    baseDb.message.findMany({ where: viaContact }),
    baseDb.reply.findMany({ where: viaContact }),
    baseDb.opportunity.findMany({ where: viaAccount }),
    baseDb.task.findMany({ where: viaAccount }),
    baseDb.note.findMany({ where: viaAccount }),
    baseDb.sellerPackRevision.findFirst({ where: own, orderBy: { createdAt: "desc" }, select: { pack: true, createdAt: true, version: true } }),
  ]);
  const zip = new JSZip();
  const files: [string, Record<string, unknown>[]][] = [["companies", companies], ["people", people], ["facts", facts], ["emails", emails], ["replies", replies], ["deals", deals], ["tasks", tasks], ["notes", notes]];
  for (const [name, rows] of files) zip.file(`${name}.csv`, csv(rows as Record<string, unknown>[]));
  zip.file("account-brain.json", JSON.stringify(brain ?? null, null, 2));
  zip.file("README.txt", `Export of ${client.name}, made ${new Date().toISOString()} by ${me.email}.\n\n` + files.map(([n, r]) => `${n}.csv: ${r.length} rows`).join("\n") + "\naccount-brain.json: the client's Account Brain\n");
  const body = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  await audit(me.email, "client.export", { target: client.name, clientId: id, after: Object.fromEntries(files.map(([n, r]) => [n, r.length])) });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(body as unknown as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${id}-export-${day}.zip"`, "cache-control": "no-store" } });
}
