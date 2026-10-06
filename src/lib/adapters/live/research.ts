// Live web research: Exa, Tavily and SerpAPI (Google). Queries are built from the
// seller's research questions.

import type { ResearchPage, ResearchPass, ResearchSource, SearchHint } from "../types";
import { fetchJson, parseLooseDate } from "./http";

const DAY = 86_400_000;

/** Search intent per research question, phrased for the seller (Manch). */
export function queryFor(key: string, company: string): { q: string; days: number | null; news: boolean } {
  const c = `"${company}"`;
  switch (key) {
    case "trigger":
      return { q: `${c} (SAP S/4HANA OR ERP migration OR distributors OR dealer network OR expansion OR acquisition OR funding OR digital transformation OR vendor onboarding)`, days: 120, news: true };
    case "negative":
      return { q: `${c} (layoffs OR job cuts OR hiring freeze OR acquired OR insolvency OR bankruptcy)`, days: 120, news: true };
    case "owner_function":
      return { q: `${c} careers (master data OR procurement OR vendor onboarding OR distributor onboarding OR SAP)`, days: 365, news: false };
    case "tooling":
      return { q: `${c} (SAP OR Oracle OR "Microsoft Dynamics" OR Informatica OR "master data management")`, days: 730, news: false };
    case "partner_network":
      return { q: `${c} (distributors OR dealers OR retail outlets OR suppliers OR vendors OR delivery partners)`, days: 730, news: false };
    default:
      return { q: `${c} ${key.replace(/_/g, " ")}`, days: 365, news: false };
  }
}

export function classifySource(url: string, domain: string): ResearchPage["sourceType"] {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "");
    path = u.pathname.toLowerCase();
  } catch {
    return "news";
  }
  if (domain && (host === domain || host.endsWith(`.${domain}`))) return /career|jobs/.test(path) ? "careers" : "official";
  if (/linkedin\.com\/jobs|naukri|indeed|glassdoor|foundit/.test(host + path)) return "careers";
  if (/prnewswire|businesswire|globenewswire|newswire|pressrelease|press/.test(host + path)) return "press";
  if (/g2\.com|capterra|stackshare|getapp|trustradius/.test(host)) return "review_site";
  return "news";
}

interface ExaResult { url: string; title?: string; publishedDate?: string; published_date?: string; text?: string }
interface TavilyResult { url: string; title?: string; content?: string; published_date?: string }

export interface ResearchKeys { exa?: string; serp?: string; tavily?: string }
type Engine = "exa" | "tavily" | "serp";

/**
 * Web research over up to three engines. The main pass prefers Exa (full page text);
 * follow-up and re-open passes prefer a different engine so the second source is
 * independent. If an engine returns nothing or fails, the next configured one is tried.
 */
export class WebResearch implements ResearchSource {
  readonly live = true;
  constructor(private keys: ResearchKeys) {}

  engines(): Engine[] {
    return (["exa", "tavily", "serp"] as Engine[]).filter((e) => this.keys[e]);
  }

  private async exa(q: string, days: number | null, domain: string): Promise<ResearchPage[]> {
    const body: Record<string, unknown> = { query: q, numResults: 6, type: "auto", contents: { text: { maxCharacters: 2500 } } };
    if (days) body.startPublishedDate = new Date(Date.now() - days * DAY).toISOString();
    const res = await fetchJson<{ results?: ExaResult[] }>("Exa", "https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.keys.exa! },
      body: JSON.stringify(body),
    });
    return (res.results ?? []).flatMap((r) => {
      const published = parseLooseDate(r.publishedDate ?? r.published_date);
      if (!published) return [];
      return [{ url: r.url, title: r.title ?? r.url, publishedAt: published, text: (r.text ?? r.title ?? "").slice(0, 2500), sourceType: classifySource(r.url, domain) }];
    });
  }

  private async tavily(q: string, days: number | null, news: boolean, domain: string): Promise<ResearchPage[]> {
    // Tavily only dates results on the news topic; undated results can't pass the evidence gate.
    const body: Record<string, unknown> = { query: q.replace(/"/g, ""), topic: "news", max_results: 8, search_depth: "basic", days: days ?? 365 };
    if (!news) body.days = Math.max(days ?? 365, 365);
    const res = await fetchJson<{ results?: TavilyResult[] }>("Tavily", "https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.keys.tavily}` },
      body: JSON.stringify(body),
    });
    return (res.results ?? []).flatMap((r) => {
      const published = parseLooseDate(r.published_date);
      if (!published) return [];
      return [{ url: r.url, title: r.title ?? r.url, publishedAt: published, text: `${r.title ?? ""}. ${r.content ?? ""}`.slice(0, 2000), sourceType: classifySource(r.url, domain) }];
    });
  }

  private async serp(q: string, news: boolean, domain: string): Promise<ResearchPage[]> {
    const params = new URLSearchParams({ engine: "google", q, api_key: this.keys.serp!, num: "8", hl: "en" });
    if (news) params.set("tbm", "nws");
    const res = await fetchJson<{ news_results?: { link: string; title: string; snippet?: string; date?: string; source?: string }[]; organic_results?: { link: string; title: string; snippet?: string; date?: string }[] }>(
      "SerpAPI", `https://serpapi.com/search.json?${params}`,
    );
    const items = news ? res.news_results ?? [] : res.organic_results ?? [];
    return items.flatMap((r) => {
      const published = parseLooseDate(r.date);
      if (!published) return []; // undated results can't pass the evidence gate
      return [{ url: r.link, title: r.title, publishedAt: published, text: `${r.title}. ${r.snippet ?? ""}`.slice(0, 1500), sourceType: classifySource(r.link, domain) }];
    });
  }

  private run(engine: Engine, q: string, days: number | null, news: boolean, domain: string) {
    if (engine === "exa") return this.exa(q, days, domain);
    if (engine === "tavily") return this.tavily(q, days, news, domain);
    return this.serp(q, news, domain);
  }

  async search(domain: string, companyName: string, key: string, pass: ResearchPass, hint: SearchHint = {}): Promise<ResearchPage[]> {
    const base = queryFor(key, companyName);
    const q = hint.query?.trim() || base.q;
    const { days, news } = base;
    // The brain's choice goes first; otherwise main/refresh prefer Exa and follow-up/reopen
    // prefer a different engine so the second source is independent.
    const preferred: Engine[] = pass === "main" || pass === "refresh" ? ["exa", "tavily", "serp"] : ["serp", "tavily", "exa"];
    const chosen = (["exa", "tavily", "serp"] as Engine[]).find((e) => e === hint.engine);
    const order = (chosen ? [chosen, ...preferred.filter((e) => e !== chosen)] : preferred).filter((e) => this.keys[e]);
    const name = companyName.toLowerCase().split(/\s+/)[0];
    let lastError: unknown = null;
    for (const engine of order) {
      let pages: ResearchPage[];
      try {
        pages = await this.run(engine, q, days, news, domain);
      } catch (e) {
        lastError = e; // quota or outage on one engine — try the next
        hint.onAttempt?.({ engine, results: 0, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
        continue;
      }
      // Keep only pages that actually mention the company. Stop at the first engine
      // with usable results: no paying a second engine to repeat the same answer.
      const relevant = pages.filter((p) => `${p.title} ${p.text}`.toLowerCase().includes(name) || (domain && p.url.includes(domain)));
      hint.onAttempt?.({ engine, results: relevant.length });
      if (relevant.length) return relevant.slice(0, 5).map((p) => ({ ...p, engine }));
    }
    if (lastError && order.length) throw lastError;
    return [];
  }
}
