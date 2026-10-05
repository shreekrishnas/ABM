import { db } from "@/lib/db";
import { authorize, json, serialize } from "@/lib/api";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = authorize(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const account = await db.account.findUnique({
    where: { id },
    include: { contacts: { include: { fieldStates: true } }, twins: { orderBy: { version: "desc" }, take: 1 }, opportunities: true },
  });
  if (!account) return json({ error: "not_found" }, 404);
  return json(serialize({ data: account }));
}
