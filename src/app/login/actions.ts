"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MODE_COOKIE, audit, getMe } from "@/lib/me";
import { SESSION_COOKIE } from "@/lib/auth";

// Signing in is not a server action: the sign-in form and the emailed link post to route handlers
// (/login/submit, /login/verify/submit; logic in lib/sign-in), so the request gate can refuse every
// server action from a signed-out visitor. The actions below are for people who are signed in.

export async function signOutAction() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(MODE_COOKIE);
  redirect("/login");
}

/** Which client to work on ("all" = every client this person may see). Checked again on every query. */
export async function switchClientAction(id: string, to?: string | FormData) {
  const { CLIENT_COOKIE, clearScopeCache, resolveScope } = await import("@/lib/scope");
  const jar = await cookies();
  // Only an account this person is assigned to can be opened (every query also re-checks this).
  const scope = await resolveScope();
  if (id !== "all" && scope && !scope.choices.some((c) => c.id === id)) redirect("/clients?denied=1");
  if (id === "all") jar.delete(CLIENT_COOKIE);
  else jar.set(CLIENT_COOKIE, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86_400 });
  clearScopeCache();
  // A fresh request, so every number is read with the new client (not the one the page was drawn with).
  const { headers } = await import("next/headers");
  const ref = (await headers()).get("referer");
  let back = "/";
  try {
    if (ref) back = new URL(ref).pathname + new URL(ref).search;
  } catch {}
  // Opening an account from the Accounts page lands on its Home; switching elsewhere stays on the page.
  if (typeof to === "string" && to.startsWith("/") && !to.startsWith("//")) back = to;
  else if (back.startsWith("/clients")) back = "/";
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : "/");
}

/** Sri Krishna's switch: Super Admin on or off for this session. The entitlement itself never changes here. */
export async function switchModeAction(to: "super" | "user") {
  const me = await getMe();
  if (!me?.canSuperAdmin) return;
  const jar = await cookies();
  if (to === "super") jar.set(MODE_COOKIE, "super", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 8 * 3600 });
  else jar.delete(MODE_COOKIE);
  await audit(me.email, to === "super" ? "mode.super_admin" : "mode.user");
  redirect(to === "super" ? "/team" : "/");
}
