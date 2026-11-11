// API keys a Super Admin enters in the app (Admin → Integrations), and each integration's
// on/off switch. Keys are stored encrypted (AES-256-GCM, keyed from AUTH_SECRET) and are never
// shown again: only their last four characters. A key saved in the app wins over the same
// variable in Vercel; switching an integration off hides its keys from the app until it is on.
//
// The app reads keys from process.env everywhere, so this module lays the saved keys over it
// (cached 30 s per server instance) at the entry points: page renders, actions and background runs.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { baseDb } from "@/lib/db-base";

export interface KeyField { env: string; label: string; secret: boolean; required?: boolean; placeholder?: string; help?: string }
export interface IntegrationSpec { key: string; name: string; fields: KeyField[]; anyOf?: boolean; note?: string }

/** Integrations that take keys. `anyOf`: one of the fields is enough (e.g. any one search engine). */
export const INTEGRATION_KEYS: IntegrationSpec[] = [
  { key: "openrouter", name: "OpenRouter (AI)", fields: [{ env: "OPENROUTER_API_KEY", label: "API key", secret: true, required: true, placeholder: "sk-or-…", help: "openrouter.ai → Keys" }], note: "Switching this off pauses all AI spending." },
  { key: "search", name: "Web search", anyOf: true, fields: [
    { env: "EXA_API_KEY", label: "Exa key", secret: true, placeholder: "exa key" },
    { env: "TAVILY_API_KEY", label: "Tavily key", secret: true, placeholder: "tvly-…" },
    { env: "SERPAPI_API_KEY", label: "SerpAPI key", secret: true, placeholder: "serpapi key" },
  ], note: "One search engine is enough." },
  { key: "apollo", name: "Apollo", fields: [
    { env: "APOLLO_API_KEY", label: "API key (master)", secret: true, required: true, help: "Apollo → Settings → Integrations → API" },
    { env: "APOLLO_VISITOR_LIST", label: "Website visitor list name", secret: false, placeholder: "Website visitors (optional)" },
  ] },
  { key: "email", name: "Email sending", fields: [
    { env: "SMTP_URL", label: "Mailbox address (SMTP URL)", secret: true, required: true, placeholder: "smtps://user:password@smtp.example.com:465" },
    { env: "SMTP_FROM", label: "Send from", secret: false, required: true, placeholder: "Your Name <you@company.com>" },
  ], note: "Once on, sign-in also switches to emailed one-time links." },
];

const ALL_ENV = INTEGRATION_KEYS.flatMap((i) => i.fields.map((f) => f.env));
// What Vercel set when this server instance started, before anything was laid over it.
const ORIGINAL: Record<string, string | undefined> = Object.fromEntries(ALL_ENV.map((n) => [n, process.env[n]?.trim() || undefined]));

function cryptoKey(): Buffer | null {
  const s = process.env.AUTH_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  return s ? createHash("sha256").update(`integration-keys|${s}`).digest() : null;
}

export function encryptKeys(values: Record<string, string>): string {
  const key = cryptoKey();
  if (!key) throw new Error("Saving keys needs AUTH_SECRET to be set in Vercel");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(values), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

export function decryptKeys(blob: string | null | undefined): Record<string, string> {
  if (!blob) return {};
  const key = cryptoKey();
  if (!key) return {};
  try {
    const [iv, tag, body] = blob.split(".").map((p) => Buffer.from(p, "base64"));
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

let syncedAt = 0;
let lastSignature = "";

/** Lay saved keys and on/off switches over process.env. Cheap: cached for 30 s unless forced. */
export async function syncIntegrationEnv(force = false): Promise<void> {
  if (!force && Date.now() - syncedAt < 30_000) return;
  syncedAt = Date.now();
  const rows = await baseDb.integrationSetting.findMany().catch(() => null);
  if (!rows) return;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const spec of INTEGRATION_KEYS) {
    const row = byKey.get(spec.key);
    const saved = decryptKeys(row?.secrets);
    // OpenRouter's switch is the AI pause (which also stops queued work cleanly), not a removed key.
    const off = spec.key !== "openrouter" && row?.enabled === false;
    for (const f of spec.fields) {
      const v = off ? undefined : saved[f.env] || ORIGINAL[f.env];
      if (v) process.env[f.env] = v;
      else delete process.env[f.env];
    }
  }
  const signature = ALL_ENV.map((n) => `${n}=${process.env[n] ? createHash("sha1").update(process.env[n]!).digest("hex").slice(0, 8) : ""}`).join("|");
  if (signature !== lastSignature) {
    lastSignature = signature;
    const { setAdapters } = await import("@/lib/adapters");
    setAdapters(null); // rebuilt from the new keys on next use
  }
}

export type FieldState = KeyField & { source: "app" | "vercel" | null; hint: string | null };
export interface IntegrationKeyState { key: string; enabled: boolean; ready: boolean; fields: FieldState[]; updatedAt: Date | null; updatedBy: string | null }

const hintOf = (v: string, secret: boolean) => (secret ? `••••${v.slice(-4)}` : v.length > 40 ? `${v.slice(0, 40)}…` : v);

/** Per integration: switched on or off, whether its required keys are present, and where each key comes from. */
export async function integrationKeyStates(): Promise<Map<string, IntegrationKeyState>> {
  const rows = await baseDb.integrationSetting.findMany().catch(() => []);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = new Map<string, IntegrationKeyState>();
  for (const spec of INTEGRATION_KEYS) {
    const row = byKey.get(spec.key);
    const saved = decryptKeys(row?.secrets);
    const fields: FieldState[] = spec.fields.map((f) => {
      const v = saved[f.env] || ORIGINAL[f.env];
      return { ...f, source: saved[f.env] ? "app" : ORIGINAL[f.env] ? "vercel" : null, hint: v ? hintOf(v, f.secret) : null };
    });
    const ready = spec.anyOf ? fields.some((f) => f.source) : fields.filter((f) => f.required).every((f) => f.source);
    out.set(spec.key, { key: spec.key, enabled: row?.enabled ?? true, ready, fields, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null });
  }
  return out;
}
