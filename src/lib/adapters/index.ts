import type { Adapters } from "./types";
import { createMockAdapters } from "./mock";
import { WebResearch } from "./live/research";
import { OpenRouterLLM } from "./live/openrouter";
import { DisconnectedSender, MxVerifier, NoProvider, SmtpSender } from "./live/email";
import { OpenRouterEmbedder } from "./live/embeddings";

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
    { key: "embedder", label: "Knowledge base embeddings", mode: !off && llmKey ? "live" : "mock", via: !off && llmKey ? `OpenRouter · ${env("EMBED_MODEL") ?? "openai/text-embedding-3-small"}` : "Offline word matching (set OPENROUTER_API_KEY for meaning-based search)" },
    { key: "provider", label: "Contact data provider", mode: off ? "mock" : "live", via: off ? "Sample people" : "None connected — only imported people are used (Apollo later)" },
    { key: "mailbox", label: "Email verification", mode: off ? "mock" : "live", via: "Free MX check (domain accepts email)" },
    { key: "email", label: "Email sending", mode: !off && env("SMTP_URL") ? "live" : "mock", via: env("SMTP_URL") ? "SMTP mailbox" : off ? "Sample sender" : "Not connected — approved emails are held (set SMTP_URL)" },
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
  if (llmKey) {
    a.llm = new OpenRouterLLM(llmKey);
    a.embedder = new OpenRouterEmbedder(llmKey);
  }
  // Real data: never use sample people or a pretend mailbox on real companies.
  a.provider = new NoProvider();
  a.mailbox = new MxVerifier();
  const smtp = env("SMTP_URL");
  a.email = smtp ? new SmtpSender(smtp, env("SMTP_FROM")) : new DisconnectedSender();
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
