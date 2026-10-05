import { db } from "@/lib/db";
import { authorize, json } from "@/lib/api";

export async function GET(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId") ?? undefined;
  const contacts = await db.contact.findMany({ where: { mergedIntoId: null, ...(accountId ? { accountId } : {}) }, take: 200, orderBy: { updatedAt: "desc" } });
  return json({ data: contacts });
}
