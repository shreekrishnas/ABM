import { signInWithEmail } from "@/lib/sign-in";
import { requestInfo, signInResponse } from "@/lib/sign-in-response";

export const dynamic = "force-dynamic";

/** The sign-in form posts here (a route handler, so signed-out visitors need no server action). */
export async function POST(req: Request) {
  const fd = await req.formData().catch(() => new FormData());
  const r = await signInWithEmail(fd.get("email"), fd.get("next"), requestInfo(req));
  return signInResponse(req, r, fd.get("next"));
}
