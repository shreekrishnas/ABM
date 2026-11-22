"use server";

// What remains of the old admin assistant's server side: its browser-error reporter, used by the
// error boundary around Vega. The assistant itself is now Vega (src/app/vega/actions.ts); its
// "This week" digest and saved questions moved there.

import { getMe } from "@/lib/me";

/** Browser-side errors in the assistant, kept in the error log (Super Admins only). */
export async function reportAssistantClientError(message: string, stack: string): Promise<void> {
  const u = await getMe().catch(() => null);
  if (!u?.superAdmin) return;
  const { recordError } = await import("@/lib/admin/errors");
  await recordError("assistant.client", new Error(message.slice(0, 500)), stack.slice(0, 1500));
}
