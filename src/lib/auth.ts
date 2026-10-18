// Sign-in for the team: only addresses on the allowed domain(s) get in.
// Sessions are HMAC-signed cookies (Web Crypto, so the proxy can read them).

export const SESSION_COOKIE = "abm_session";
export const SESSION_DAYS = 14;

/** Allowed email domains, from AUTH_EMAIL_DOMAINS (comma-separated). */
export function allowedDomains(): string[] {
  return (process.env.AUTH_EMAIL_DOMAINS || "trilliantdigital.com").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200 ? e : null;
}

export function domainAllowed(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  return allowedDomains().includes(domain);
}

/** The signing secret; null means sign-in can't be issued (the login page says so). */
export function authSecret(): string | null {
  return process.env.AUTH_SECRET?.trim() || process.env.CRON_SECRET?.trim() || null;
}

/** On in production, or anywhere AUTH_REQUIRED=true. */
export function authRequired(): boolean {
  return process.env.AUTH_REQUIRED === "true" || (process.env.NODE_ENV === "production" && process.env.AUTH_REQUIRED !== "false");
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sign(payload: object, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verify<T extends { exp: number }>(token: string | undefined, secret: string): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, await hmac(secret, body))) return null;
  try {
    const data = JSON.parse(fromB64url(body)) as T;
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export type Session = { email: string; exp: number };

export const sessionToken = (email: string, secret: string) => sign({ email, exp: Date.now() + SESSION_DAYS * 86_400_000 } satisfies Session, secret);
