import type { Adapters } from "./types";
import { createMockAdapters } from "./mock";
import { WebResearch } from "./live/research";
import { OpenRouterLLM } from "./live/openrouter";

// Each external service goes live on its own once its API key is set in the
// environment; everything else stays on the deterministic mock. Stages only see
// the interfaces. Keys live in Vercel env vars, never in the repo.

export type ServiceKey = keyof Adapters;
export interface ServiceStatus { key: ServiceKey; label: string; mode: "live" | "mock"; via: string }

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** ADAPTER_MODE=mock forces every service onto mocks (tests, demos). */
function forcedMock() {
  return process.env.ADAPTER_MODE === "mock";
}

function researchKeys() {
  return { exa: env("EXA_API_KEY"), tavily: env("TAVILY_API_KEY"), serp: env("SERPAPI_API_KEY") };
}

export function serviceStatus(): ServiceStatus[] {
  const off = forcedMock();
  const r = researchKeys();
  const engines = [r.exa && "Exa", r.tavily && "Tavily", r.serp && "SerpAPI"].filter(Boolean).join(" + ");
  const llmKey = env("OPENROUTER_API_KEY");
  return [
    { key: "research", label: "Web research", mode: !off && engines ? "live" : "mock", via: engines || "Exa / Tavily / SerpAPI" },
    { key: "llm", label: "LLM (extract, draft, classify)", mode: !off && llmKey ? "live" : "mock", via: `OpenRouter · ${env("LLM_MODEL") ?? "openai/gpt-4o-mini"}` },
    { key: "provider", label: "Contact data provider", mode: "mock", via: "Apollo (pending)" },
    { key: "mailbox", label: "Mailbox verification", mode: "mock", via: "MX check (planned, free)" },
    { key: "email", label: "Email sending", mode: "mock", via: "Gmail / Microsoft 365 (planned)" },
    { key: "intent", label: "Intent data", mode: "mock", via: "Website visits (planned)" },
    { key: "notifier", label: "Alerts", mode: "mock", via: "Slack / Teams webhook (planned)" },
  ];
}

export function createAdapters(): Adapters {
  const a: Adapters = createMockAdapters();
  if (forcedMock()) return a;
  const r = researchKeys();
  if (r.exa || r.tavily || r.serp) a.research = new WebResearch(r);
  const llmKey = env("OPENROUTER_API_KEY");
  if (llmKey) a.llm = new OpenRouterLLM(llmKey);
  return a;
}

let instance: Adapters | null = null;

export function getAdapters(): Adapters {
  if (!instance) instance = createAdapters();
  return instance;
}

/** Tests inject their own adapters. */
export function setAdapters(a: Adapters | null) {
  instance = a;
}

export type { Adapters } from "./types";
