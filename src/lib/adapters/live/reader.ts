// Reads a source page in full, where the site permits it, instead of relying on a search
// snippet. robots.txt is honoured (a disallowed page keeps its snippet), pages are size-capped,
// and only the readable text is kept: scripts, styles, navigation and footers are dropped.

const UA = "TrilliantResearchBot/1.0 (+https://abm-chi.vercel.app)";
const MAX_BYTES = 2_000_000;
/** Text kept per page: enough for a long article, small enough to pass around. */
export const MAX_PAGE_CHARS = 24_000;

const robotsCache = new Map<string, { at: number; disallow: string[] }>();

/** Disallow rules for any user agent ("*") from a robots.txt body. */
export function parseRobots(body: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k)) applies = v === "*";
    else if (applies && /^disallow$/i.test(k) && v) out.push(v);
  }
  return out;
}

async function allowed(url: URL, timeoutMs: number): Promise<boolean> {
  const host = url.origin;
  const hit = robotsCache.get(host);
  let rules = hit && Date.now() - hit.at < 86_400_000 ? hit.disallow : null;
  if (!rules) {
    try {
      const res = await fetch(`${host}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
      rules = res.ok ? parseRobots((await res.text()).slice(0, 100_000)) : [];
    } catch {
      rules = [];
    }
    robotsCache.set(host, { at: Date.now(), disallow: rules });
  }
  return !rules.some((r) => url.pathname.startsWith(r.replace(/\*.*$/, "")));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };

/** Readable text from HTML: block elements become paragraph breaks, boilerplate is removed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** The full readable text of a page, or null when the site disallows it, it isn't HTML/text, or it fails. */
export async function readPage(rawUrl: string, timeoutMs = 12_000): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (!(await allowed(url, Math.min(timeoutMs, 5_000)))) return null;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/plain" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) return null;
    const body = (await res.text()).slice(0, MAX_BYTES);
    const text = /html/.test(type) ? htmlToText(body) : body.trim();
    return text.length > 200 ? text.slice(0, MAX_PAGE_CHARS) : null;
  } catch {
    return null;
  }
}

/**
 * The parts of a long page worth reading for one company: paragraphs that name it, with
 * one paragraph either side for context, up to `max` characters. Falls back to the start.
 */
export function relevantText(text: string, marks: string[], max = 6_000): string {
  if (text.length <= max || !marks.length) return text.slice(0, max);
  const paras = text.split(/\n+/);
  const lower = paras.map((p) => p.toLowerCase());
  const keep = new Set<number>();
  lower.forEach((p, i) => {
    if (marks.some((m) => p.includes(m))) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < paras.length) keep.add(j);
  });
  if (!keep.size) return text.slice(0, max);
  let out = "";
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (out.length + paras[i].length + 1 > max) break;
    out += `${paras[i]}\n`;
  }
  return out.trim() || text.slice(0, max);
}
