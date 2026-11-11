// Live web research: Exa, Tavily and SerpAPI (Google). Queries are built from the
// seller's research questions.

import type { ResearchPage, ResearchPass, ResearchSource, SearchHint } from "../types";
import { fetchJson, parseLooseDate } from "./http";
import { seller } from "@/lib/seller";
import { readPage } from "./reader";
import { companyMarks } from "@/lib/pipeline/gates";
import { cachedPages, searchKey, storePages } from "@/lib/research/search-cache";
import { ownSiteTier } from "@/lib/research/precision";

const DAY = 86_400_000;

/** Search intent per research question. Seller-specific terms come from the active seller pack; website, firmographics and negative news are generic. */
export function queryFor(key: string, company: string): { q: string; days: number | null; news: boolean } {
  const c = `"${company}"`;
  if (key === "website") return { q: `${c} official website`, days: null, news: false };
  if (key === "firmographics") return { q: `${c} company profile employees industry headquarters`, days: null, news: false };
  if (key === "lookalike_intent") return { q: `${c} expansion OR investment OR hiring OR new plant OR digital transformation`, days: 365, news: true };
  if (key.startsWith("lookalike")) return { q: "", days: null, news: false };
  // Company search from a description: profile pages and lists, recent but not news-only.
  if (key === "discover_brief") return { q: "", days: 730, news: false };
  // Company profile: results are yearly, funding history goes back years, boards and stacks change slowly.
  if (key === "profile:financials") return { q: `${c} annual results revenue net profit`, days: 760, news: false };
  if (key === "profile:funding") return { q: `${c} raises funding round investors`, days: 1825, news: false };
  if (key === "profile:tech_stack") return { q: `${c} SAP OR Oracle OR Salesforce OR "Microsoft Dynamics" OR ServiceNow`, days: 1095, news: false };
  if (key === "profile:board") return { q: `${c} board of directors independent director`, days: null, news: false };
  if (key === "market:hiring") return { q: "", days: 60, news: false };
  if (key.startsWith("market")) return { q: "", days: 90, news: true };
  const s = seller().researchQuestions.find((x) => x.key === key)?.search;
  if (s) return { q: `${c} ${s.terms}`, days: s.days, news: s.news };
  if (key === "negative") return { q: `${c} (layoffs OR job cuts OR hiring freeze OR acquired OR insolvency OR bankruptcy)`, days: 120, news: true };
  return { q: `${c} ${key.replace(/_/g, " ")}`, days: 365, news: false };
}

/** Profile-style lookups (a company's own site, what it does) need no date; news and intent do. */
const undatedAllowed = (key: string) => key === "website" || key === "firmographics" || key === "profile:board" || key === "profile:tech_stack" || key === "profile:financials" || key === "discover_brief" || (key.startsWith("lookalike") && key !== "lookalike_intent");

const NEWS_HOST = /(news|times|express|standard|mint|hindu|reuters|bloomberg|moneycontrol|businessworld|business-?today|forbes|techcrunch|financial|journal|herald|tribune|post|today|ndtv|cnbc|yourstory|inc42|entrackr|vccircle|medianama|thehindubusinessline|zeebiz|outlook|fortune|wsj|ft\.com|bbc|cnn|apnews|dealstreet|thearcweb|etauto|etcio|ethealthworld|expresspharma|pharmabiz|autocar)/;

/**
 * How strong a source is. On the company's own site, press, investor and about pages are
 * official; blogs and product pages are the company site; careers pages are careers.
 * Elsewhere: wire services are press, recognised publishers or news results are news,
 * everything else is a web page (weakest).
 */
export function classifySource(url: string, domain: string, newsResult = false): ResearchPage["sourceType"] {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "");
    path = u.pathname.toLowerCase();
  } catch {
    return "web";
  }
  if (domain && (host === domain || host.endsWith(`.${domain}`))) return ownSiteTier(path);
  if (/linkedin\.com\/jobs|naukri|indeed|glassdoor|foundit/.test(host + path)) return "careers";
  if (/prnewswire|businesswire|globenewswire|newswire|pressrelease|einpresswire|pr\.com/.test(host)) return "press";
  if (/g2\.com|capterra|stackshare|getapp|trustradius/.test(host)) return "review_site";
  if (newsResult || NEWS_HOST.test(host) || /\/(news|article|articles|story|stories)\//.test(path)) return "news";
  return "web";
}

/** Google's recency filter for a window in days (SerpAPI "tbs"). */
const serpWindow = (days: number | null) => (!days ? null : days <= 1 ? "qdr:d" : days <= 7 ? "qdr:w" : days <= 31 ? "qdr:m" : days <= 366 ? "qdr:y" : null);

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

  private async exa(q: string, days: number | null, domain: string, undatedOk = false): Promise<ResearchPage[]> {
    const body: Record<string, unknown> = { query: q, numResults: 6, type: "auto", contents: { text: { maxCharacters: 2500 } } };
    if (days) body.startPublishedDate = new Date(Date.now() - days * DAY).toISOString();
    const res = await fetchJson<{ results?: ExaResult[] }>("Exa", "https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.keys.exa! },
      body: JSON.stringify(body),
    });
    return (res.results ?? []).flatMap((r) => {
      const dated = parseLooseDate(r.publishedDate ?? r.published_date);
      const published = dated ?? (undatedOk ? new Date() : null);
      if (!published) return [];
      return [{ url: r.url, title: r.title ?? r.url, publishedAt: published, undated: !dated, text: (r.text ?? r.title ?? "").slice(0, 2500), sourceType: classifySource(r.url, domain) }];
    });
  }

  private async tavily(q: string, days: number | null, news: boolean, domain: string, undatedOk = false): Promise<ResearchPage[]> {
    // Tavily only dates results on the news topic; undated results can't pass the evidence gate
    // (except gap-fill lookups such as the official website, which need no date).
    const body: Record<string, unknown> = undatedOk
      ? { query: q.replace(/"/g, ""), topic: "general", max_results: 8, search_depth: "basic" }
      : { query: q.replace(/"/g, ""), topic: "news", max_results: 8, search_depth: "basic", days: days ?? 365 };
    if (!news && !undatedOk) body.days = Math.max(days ?? 365, 365);
    const res = await fetchJson<{ results?: TavilyResult[] }>("Tavily", "https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.keys.tavily}` },
      body: JSON.stringify(body),
    });
    return (res.results ?? []).flatMap((r) => {
      const dated = parseLooseDate(r.published_date);
      const published = dated ?? (undatedOk ? new Date() : null);
      if (!published) return [];
      return [{ url: r.url, title: r.title ?? r.url, publishedAt: published, undated: !dated, text: `${r.title ?? ""}. ${r.content ?? ""}`.slice(0, 2000), sourceType: classifySource(r.url, domain, body.topic === "news") }];
    });
  }

  private async serp(q: string, days: number | null, news: boolean, domain: string, undatedOk = false): Promise<ResearchPage[]> {
    const params = new URLSearchParams({ engine: "google", q, api_key: this.keys.serp!, num: "8", hl: "en" });
    if (news) params.set("tbm", "nws");
    const window = undatedOk ? null : serpWindow(days);
    if (window) params.set("tbs", window);
    const res = await fetchJson<{ news_results?: { link: string; title: string; snippet?: string; date?: string; source?: string }[]; organic_results?: { link: string; title: string; snippet?: string; date?: string }[] }>(
      "SerpAPI", `https://serpapi.com/search.json?${params}`,
    );
    const items = news ? res.news_results ?? [] : res.organic_results ?? [];
    return items.flatMap((r) => {
      const dated = parseLooseDate(r.date);
      const published = dated ?? (undatedOk ? new Date() : null);
      if (!published) return []; // undated results can't pass the evidence gate
      return [{ url: r.link, title: r.title, publishedAt: published, undated: !dated, text: `${r.title}. ${r.snippet ?? ""}`.slice(0, 1500), sourceType: classifySource(r.link, domain, news) }];
    });
  }

  private run(engine: Engine, q: string, days: number | null, news: boolean, domain: string, undatedOk: boolean) {
    if (engine === "exa") return this.exa(q, days, domain, undatedOk);
    if (engine === "tavily") return this.tavily(q, days, news, domain, undatedOk);
    return this.serp(q, days, news, domain, undatedOk);
  }

  /** Exa's "find similar": pages of companies whose sites resemble this one (lookalike discovery). */
  async findSimilar(url: string): Promise<ResearchPage[]> {
    if (!this.keys.exa) return [];
    const ck = searchKey(["similar", url]);
    const hit = await cachedPages(ck);
    if (hit) return hit;
    const pages = await this.findSimilarLive(url);
    await storePages(ck, pages);
    return pages;
  }

  private async findSimilarLive(url: string): Promise<ResearchPage[]> {
    await (await import("@/lib/admin/research-clients")).assertResearchAllowed();
    const res = await fetchJson<{ results?: ExaResult[] }>("Exa", "https://api.exa.ai/findSimilar", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.keys.exa ?? "" },
      body: JSON.stringify({ url, numResults: 15, excludeSourceDomain: true, contents: { text: { maxCharacters: 1500 } } }),
    });
    const now = new Date();
    return (res.results ?? []).map((r) => ({ url: r.url, title: r.title ?? r.url, publishedAt: parseLooseDate(r.publishedDate ?? r.published_date) ?? now, text: (r.text ?? r.title ?? "").slice(0, 1500), sourceType: "official" as const, engine: "exa" }));
  }

  async search(domain: string, companyName: string, key: string, pass: ResearchPass, hint: SearchHint = {}): Promise<ResearchPage[]> {
    // The same search within 48 hours is served from the cache (no engine is queried, so nothing is charged).
    const ck = searchKey(["search", domain, companyName, key, pass, hint.query, hint.engine, hint.breadth]);
    const hit = await cachedPages(ck);
    if (hit) return hit;
    const pages = await this.searchLive(domain, companyName, key, pass, hint);
    await storePages(ck, pages);
    return pages;
  }

  private async searchLive(domain: string, companyName: string, key: string, pass: ResearchPass, hint: SearchHint = {}): Promise<ResearchPage[]> {
    // Live research is switched on per client (Super Admin → client settings); off means no search at all.
    await (await import("@/lib/admin/research-clients")).assertResearchAllowed();
    const base = queryFor(key, companyName);
    const q = hint.query?.trim() || base.q;
    const { days, news } = base;
    // The brain's choice goes first; otherwise main/refresh prefer Exa and follow-up/reopen
    // prefer a different engine so the second source is independent.
    const preferred: Engine[] = pass === "main" || pass === "refresh" ? ["exa", "tavily", "serp"] : ["serp", "tavily", "exa"];
    const chosen = (["exa", "tavily", "serp"] as Engine[]).find((e) => e === hint.engine);
    const order = (chosen ? [chosen, ...preferred.filter((e) => e !== chosen)] : preferred).filter((e) => this.keys[e]);
    // A page is kept when it names the company's brand (its first two distinctive words) or its domain.
    const brand = companyMarks(companyName, null).slice(0, 2);
    const names = (t: string) => (brand.length ? brand.every((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)) : t.includes(companyName.toLowerCase().split(/\s+/)[0]));
    const all = hint.breadth === "all";
    let lastError: unknown = null;
    const found: ResearchPage[] = [];
    for (const engine of order) {
      let pages: ResearchPage[];
      try {
        pages = await this.run(engine, q, days, news, domain, undatedAllowed(key));
      } catch (e) {
        lastError = e; // quota or outage on one engine — try the next
        hint.onAttempt?.({ engine, results: 0, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
        continue;
      }
      // Keep only pages that actually mention the company.
      const relevant = pages.filter((p) => names(`${p.title} ${p.text}`.toLowerCase()) || (domain && p.url.includes(domain)));
      hint.onAttempt?.({ engine, results: relevant.length });
      for (const p of relevant) if (!found.some((f) => f.url === p.url)) found.push({ ...p, engine });
      // Usually stop at the first engine with results; "all" asks every engine (high-value or disconfirming questions).
      if (found.length && !all) break;
    }
    if (!found.length) {
      if (lastError && order.length) throw lastError;
      return [];
    }
    // Read the best pages in full where the site allows it; otherwise keep the snippet.
    const top = found.slice(0, all ? 8 : 5);
    const read = key === "website" ? top.map(() => null) : await Promise.all(top.map((p) => readPage(p.url).catch(() => null)));
    const now = new Date();
    return top.map((p, i) => {
      let publisher = "";
      try {
        publisher = new URL(p.url).hostname.replace(/^www\./, "");
      } catch {
        publisher = "";
      }
      const full = read[i];
      return { ...p, text: full ?? p.text, full: Boolean(full), publisher, retrievedAt: now };
    });
  }
}
