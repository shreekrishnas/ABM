import { completeLinkSignIn } from "@/lib/sign-in";
import { requestInfo, signInResponse } from "@/lib/sign-in-response";

export const dynamic = "force-dynamic";

/** The "Sign in" button on an emailed link's page posts here. */
export async function POST(req: Request) {
  const fd = await req.formData().catch(() => new FormData());
  const r = await completeLinkSignIn(fd.get("t"), fd.get("next"), requestInfo(req));
  return signInResponse(req, r, fd.get("next"));
}
