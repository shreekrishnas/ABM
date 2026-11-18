import { homeHtml } from "@/components/home-v4/page-body";

export const dynamic = "force-dynamic";

// Home is a static HTML document (taste-skill layout); the sign-in gate in proxy.ts still applies.
export async function GET() {
  return new Response(await homeHtml(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
