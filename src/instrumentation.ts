// Load keys saved in the app (Admin → Integrations) as the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { syncIntegrationEnv } = await import("@/lib/integration-keys");
  await syncIntegrationEnv(true).catch(() => undefined);
}

// Server errors from pages, server actions and API routes go to the error log (System health).
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  // The database client only runs on the Node.js runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("@/lib/admin/errors");
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  await recordError(`${context.routeType} ${context.routePath}`, err, `${request.method} ${request.path.split("?")[0]}${digest ? ` · digest ${digest}` : ""}`);
};
