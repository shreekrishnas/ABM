// Website technology detection: what a company's own public pages prove is installed.
// Free, no third party, robots.txt honoured. Only the homepage and one contact/careers page
// are read; detection needs a script, tag or path match, never a mention in visible text.

import { TECH, type TechEntry } from "./catalog";

export interface WebsiteDetection {
  name: string;
  vendor: string;
  category: TechEntry["category"];
  /** The exact fragment of HTML that matched (trimmed), so a person can check it. */
  detail: string;
  url: string;
}

/** Technologies proven by markup. Pure: give it HTML, get detections (one per product). */
export function fingerprintHtml(html: string, url: string): WebsiteDetection[] {
  const out: WebsiteDetection[] = [];
  // Only markup that loads or configures something: script/link/iframe/img/form attributes and inline scripts.
  const markup = [
    ...[...html.matchAll(/<(?:script|link|iframe|img|form|meta)\b[^>]*>/gi)].map((m) => m[0]),
    ...[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].slice(0, 20_000)),
  ].join("\n");
  for (const t of TECH) {
    if (!t.web) continue;
    for (const re of t.web) {
      const m = markup.match(re);
      if (m) {
        const at = m.index ?? 0;
        const detail = markup.slice(Math.max(0, at - 30), at + m[0].length + 30).replace(/\s+/g, " ").trim().slice(0, 140);
        out.push({ name: t.name, vendor: t.vendor, category: t.category, detail, url });
        break;
      }
    }
  }
  return out;
}

const UA = "TrilliantResearchBot/1.0 (+https://abm-chi.vercel.app)";

async function robotsAllow(origin: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return true;
    const { parseRobots } = await import("@/lib/adapters/live/reader");
    return !parseRobots((await res.text()).slice(0, 100_000)).some((r) => path.startsWith(r.replace(/\*.*$/, "")));
  } catch {
    return true;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (!(await robotsAllow(u.origin, u.pathname))) return null;
    const res = await fetch(u, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !/html/.test(res.headers.get("content-type") ?? "")) return null;
    return (await res.text()).slice(0, 1_500_000);
  } catch {
    return null;
  }
}

/** Detect from the homepage, plus the first contact or careers page it links to (forms and ATS live there). */
export async function detectWebsiteTech(domain: string): Promise<{ detections: WebsiteDetection[]; pagesRead: string[] }> {
  const home = `https://${domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
  const html = await fetchHtml(home);
  if (!html) return { detections: [], pagesRead: [] };
  const pages = [home];
  const found = fingerprintHtml(html, home);
  const link = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]).find((h) => /\/(contact|contact-us|careers|jobs)(\/|$|\?)/i.test(h));
  if (link) {
    try {
      const next = new URL(link, home);
      if (next.hostname.replace(/^www\./, "") === new URL(home).hostname.replace(/^www\./, "")) {
        const more = await fetchHtml(next.toString());
        if (more) {
          pages.push(next.toString());
          for (const d of fingerprintHtml(more, next.toString())) if (!found.some((f) => f.name === d.name)) found.push(d);
        }
      }
    } catch {
      /* a bad link is not an error */
    }
  }
  return { detections: found, pagesRead: pages };
}
