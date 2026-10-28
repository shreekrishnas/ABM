import { ApolloProvider } from "./live/apollo";
import type { Adapters } from "./types";
import { createMockAdapters } from "./mock";
import { WebResearch } from "./live/research";
import { OpenRouterLLM } from "./live/openrouter";
import { DisconnectedResearch, DisconnectedSender, MxVerifier, NoIntent, NoProvider, SmtpSender } from "./live/email";
import { OpenRouterEmbedder } from "./live/embeddings";

// Each external service goes live on its own once its API key is set in the
// environment; everything else stays on the deterministic mock. Stages only see
// the interfaces. Keys live in Vercel env vars, never in the repo.

export type ServiceKey = keyof Adapters;
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

/**
 * Each integration's real state: live (connected and in use), off (not connected, so that part
 * is skipped or held) or sample (ADAPTER_MODE=mock: sample data everywhere, never on a real run).
 */
export type ServiceMode = "live" | "off" | "sample" | "planned";
export interface ServiceStatus { key: ServiceKey; label: string; mode: ServiceMode; via: string }
export const SERVICE_MODE_LABEL: Record<ServiceMode, string> = { live: "Live", off: "Not connected", sample: "Sample data", planned: "Planned" };

export function serviceStatus(): ServiceStatus[] {
  const sample = forcedMock();
  const r = researchKeys();
  const engines = [r.exa && "Exa", r.tavily && "Tavily", r.serp && "SerpAPI"].filter(Boolean).join(" + ");
  const llmKey = env("OPENROUTER_API_KEY");
  const apollo = env("APOLLO_API_KEY");
  const visitors = env("APOLLO_VISITOR_LIST") || env("APOLLO_VISITOR_LABEL_ID");
  const smtp = env("SMTP_URL");
  const m = (connected: boolean): ServiceMode => (sample ? "sample" : connected ? "live" : "off");
  return [
    { key: "research", label: "Web research", mode: m(Boolean(engines && llmKey)), via: engines ? (llmKey ? engines : `${engines} — paused until OPENROUTER_API_KEY is set (the AI that reads the pages)`) : "Set EXA_API_KEY, TAVILY_API_KEY or SERPAPI_API_KEY" },
    { key: "validator", label: "Research validator", mode: m(Boolean(llmKey)), via: llmKey ? `OpenRouter · ${env("VALIDATOR_MODEL") ?? env("LLM_MODEL") ?? "openai/gpt-4o-mini"}${env("VALIDATOR_MODEL") ? "" : " (set VALIDATOR_MODEL for a different model)"}` : "Set OPENROUTER_API_KEY" },
    { key: "llm", label: "LLM (extract, draft, classify)", mode: m(Boolean(llmKey)), via: llmKey ? `OpenRouter · ${env("LLM_MODEL") ?? "openai/gpt-4o-mini"}` : "Set OPENROUTER_API_KEY" },
    { key: "embedder", label: "Knowledge base embeddings", mode: m(Boolean(llmKey)), via: llmKey ? `OpenRouter · ${env("EMBED_MODEL") ?? "openai/text-embedding-3-small"}` : "Offline word matching until OPENROUTER_API_KEY is set" },
    { key: "provider", label: "Contact data provider", mode: m(Boolean(apollo)), via: apollo ? "Apollo · people search and email lookup" : "Only imported people are used (set APOLLO_API_KEY)" },
    { key: "mailbox", label: "Email verification", mode: m(true), via: "Free MX check (domain accepts email)" },
    { key: "email", label: "Email sending", mode: m(Boolean(smtp)), via: smtp ? "SMTP mailbox" : "Approved emails are held (set SMTP_URL)" },
    { key: "intent", label: "Website visitors", mode: m(Boolean(apollo && visitors)), via: apollo ? (visitors ? "Apollo website visitors · synced daily" : "Set APOLLO_VISITOR_LIST to the visitors list name") : "Set APOLLO_API_KEY and APOLLO_VISITOR_LIST" },
    { key: "notifier", label: "Alerts", mode: "planned", via: "Slack / Teams webhook" },
  ];
}

export function createAdapters(): Adapters {
  const a: Adapters = createMockAdapters();
  if (forcedMock()) return a;
  const r = researchKeys();
  const llmKey = env("OPENROUTER_API_KEY");
  const search = Boolean(r.exa || r.tavily || r.serp);
  // Live search with the sample extractor would turn page titles into "facts": both or neither.
  a.research = search && llmKey ? new WebResearch(r) : new DisconnectedResearch(!search ? "set EXA_API_KEY, TAVILY_API_KEY or SERPAPI_API_KEY" : "set OPENROUTER_API_KEY (the AI that reads the pages)");
  // No third-party intent provider is integrated yet: never a sample score on a real company.
  a.intent = new NoIntent();
  if (llmKey) {
    a.llm = new OpenRouterLLM(llmKey);
    a.embedder = new OpenRouterEmbedder(llmKey);
    // The validator is a separate role with its own instructions; VALIDATOR_MODEL can give it a different model too.
    a.validator = new OpenRouterLLM(llmKey, env("VALIDATOR_MODEL") ?? env("LLM_MODEL") ?? "openai/gpt-4o-mini");
  }
  // Real data: never use sample people or a pretend mailbox on real companies.
  const apollo = env("APOLLO_API_KEY");
  a.provider = apollo ? new ApolloProvider(apollo) : new NoProvider();
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
