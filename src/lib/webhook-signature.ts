// Optional signatures on inbound webhooks (replies, signals, visitors). With WEBHOOK_SECRET set,
// a request must carry X-ABM-Signature: sha256=<hex HMAC of the raw body>, on top of its API key.
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function signBody(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function signatureOk(body: string, header: string | null, secret: string) {
  if (!header) return false;
  const want = Buffer.from(signBody(body, secret));
  const got = Buffer.from(header.trim());
  return want.length === got.length && timingSafeEqual(want, got);
}

/** null when the request may go on; a 401 response when a configured signature is missing or wrong. */
export async function checkSignature(req: Request): Promise<NextResponse | null> {
  const secret = process.env.WEBHOOK_SECRET?.trim();
  if (!secret) return null;
  const body = await req.clone().text();
  return signatureOk(body, req.headers.get("x-abm-signature"), secret) ? null : NextResponse.json({ error: "bad or missing signature" }, { status: 401 });
}
