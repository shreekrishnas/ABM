// Job lists straight from a company's careers system. Many companies publish their openings
// through Greenhouse, Lever, Ashby or Workable, which serve the list as public JSON: exact,
// dated hiring signals for free, with no search and no AI. A job whose title matches the roles
// that own the client's problem (from the Account Brain) becomes a sourced fact.
//
// Sites without one of these systems are recorded as "none" so they aren't re-read every day;
// for them the news and search scan stays the source.

import type { SellerProfile } from "@/lib/seller/types";

export type Ats = "greenhouse" | "lever" | "ashby" | "workable";
export interface Job { title: string; url: string; location: string | null; postedAt: Date | null }
export interface CareersRead { status: "found" | "none" | "error"; ats: Ats | null; slug: string | null; jobs: Job[]; note: string | null; careersUrl: string | null }

/** Where each system's public job list lives. */
export function feedUrl(ats: Ats, slug: string): string {
  switch (ats) {
    case "greenhouse": return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
    case "lever": return `https://api.lever.co/v0/postings/${slug}?mode=json`;
    case "ashby": return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    case "workable": return `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
  }
}

const SLUG = "([a-z0-9][a-z0-9_-]{1,60})";
const PATTERNS: [Ats, RegExp][] = [
  ["greenhouse", new RegExp(`(?:boards|job-boards)(?:\\.eu)?\\.greenhouse\\.io/(?:embed/job_board(?:/js)?\\?for=)?${SLUG}`, "i")],
  ["greenhouse", new RegExp(`boards-api\\.greenhouse\\.io/v1/boards/${SLUG}`, "i")],
  ["lever", new RegExp(`jobs(?:\\.eu)?\\.lever\\.co/${SLUG}`, "i")],
  ["ashby", new RegExp(`jobs\\.ashbyhq\\.com/${SLUG}`, "i")],
  ["workable", new RegExp(`apply\\.workable\\.com/${SLUG}`, "i")],
  ["workable", new RegExp(`https?://${SLUG}\\.workable\\.com`, "i")],
];
const NOT_SLUGS = new Set(["embed", "api", "v1", "jobs", "j", "careers", "www", "apply", "boards", "widget"]);

/** The careers system a page links to, if any. */
export function detectAts(html: string): { ats: Ats; slug: string } | null {
  for (const [ats, re] of PATTERNS) {
    const m = html.match(re);
    if (m && !NOT_SLUGS.has(m[1].toLowerCase())) return { ats, slug: m[1].toLowerCase() };
  }
  return null;
}

/** Links on a page that look like its careers page. */
export function careersLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").toLowerCase();
    if (/career|jobs|join[- ]us|work[- ]with[- ]us|openings|vacanc/i.test(href) || /careers?|jobs|join us|work with us|openings/.test(text)) {
      try {
        out.add(new URL(href, base).toString());
      } catch {
        /* skip */
      }
    }
  }
  return [...out].slice(0, 4);
}

const date = (v: unknown): Date | null => {
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string" && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Each system's JSON → jobs. Unknown shapes give an empty list, never an error. */
export function parseJobs(ats: Ats, json: unknown): Job[] {
  const j = json as Record<string, unknown> | unknown[];
  let rows: Record<string, unknown>[] = [];
  if (ats === "greenhouse") rows = ((j as Record<string, unknown>)?.jobs as Record<string, unknown>[]) ?? [];
  else if (ats === "lever") rows = Array.isArray(j) ? (j as Record<string, unknown>[]) : [];
  else if (ats === "ashby") rows = ((j as Record<string, unknown>)?.jobs as Record<string, unknown>[]) ?? [];
  else if (ats === "workable") rows = ((j as Record<string, unknown>)?.jobs as Record<string, unknown>[]) ?? [];
  return rows.flatMap((r) => {
    const title = str(r.title) ?? str(r.text) ?? str(r.name);
    const url = str(r.absolute_url) ?? str(r.hostedUrl) ?? str(r.jobUrl) ?? str(r.url) ?? str(r.shortlink) ?? str(r.applyUrl);
    if (!title || !url) return [];
    const loc = (r.location as Record<string, unknown> | string | undefined) ?? (r.categories as Record<string, unknown> | undefined)?.location;
    const location = typeof loc === "string" ? loc : str((loc as Record<string, unknown> | undefined)?.name) ?? str(r.city as string) ?? null;
    const postedAt = date(r.updated_at) ?? date(r.first_published) ?? date(r.createdAt) ?? date(r.publishedAt) ?? date(r.published_on) ?? date(r.created_at);
    return [{ title: title.slice(0, 160), url, location, postedAt }];
  });
}

/** Words that mark a job as one of the roles that own the client's problem: buying-group titles and programme keywords. */
export function roleWords(p: SellerProfile): string[] {
  const titles = p.personas.flatMap((x) => x.titles);
  const programme = p.triggers.filter((t) => t.family === "programme" || t.family === "hiring").flatMap((t) => t.keywords);
  return [...new Set([...titles, ...programme].map((w) => w.toLowerCase().trim()).filter((w) => w.length >= 3))];
}

/** A title matches when it contains one of the role words as whole words ("cio" doesn't match "socio"). */
export function matchesRole(title: string, words: string[]): string | null {
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9/]+/g, " ")} `;
  return words.find((w) => t.includes(` ${w.replace(/[^a-z0-9/]+/g, " ").trim()} `)) ?? null;
}

export interface JobIO {
  html(url: string): Promise<{ html: string; finalUrl: string } | null>;
  json(url: string): Promise<unknown>;
}

/** Find the company's careers system from its homepage or careers page and read its open jobs. */
export async function readCareers(domain: string, io: JobIO): Promise<CareersRead> {
  const base = `https://${domain.replace(/^www\./, "")}`;
  const tried: string[] = [];
  let found: { ats: Ats; slug: string } | null = null;
  let careersUrl: string | null = null;
  try {
    const home = await io.html(base);
    const pages = [`${base}/careers`, `${base}/jobs`, ...(home ? careersLinks(home.html, home.finalUrl) : [])];
    if (home) {
      found = detectAts(home.html);
      if (found) careersUrl = home.finalUrl;
    }
    for (const u of [...new Set(pages)].slice(0, 4)) {
      if (found) break;
      tried.push(u);
      const page = await io.html(u);
      if (!page) continue;
      found = detectAts(page.html);
      if (found) careersUrl = page.finalUrl;
    }
  } catch (e) {
    return { status: "error", ats: null, slug: null, jobs: [], note: e instanceof Error ? e.message.slice(0, 160) : "could not read the site", careersUrl: null };
  }
  if (!found) return { status: "none", ats: null, slug: null, jobs: [], note: `No Greenhouse, Lever, Ashby or Workable link on the homepage or ${tried.length} careers page(s)`, careersUrl: null };
  try {
    const jobs = parseJobs(found.ats, await io.json(feedUrl(found.ats, found.slug)));
    return { status: "found", ats: found.ats, slug: found.slug, jobs, note: `${jobs.length} open job${jobs.length === 1 ? "" : "s"}`, careersUrl };
  } catch (e) {
    return { status: "error", ats: found.ats, slug: found.slug, jobs: [], note: `Job list unavailable: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`, careersUrl };
  }
}
