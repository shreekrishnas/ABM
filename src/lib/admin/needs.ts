// What a Prospecting page needs switched on (AI, web search, Apollo), each with its real state.
import { aiPause } from "@/lib/admin/ai-pause";
import { integrationKeyStates } from "@/lib/integration-keys";

export type NeedKey = "ai" | "search" | "apollo";
export interface Need { key: NeedKey; label: string; state: "on" | "waiting" | "off"; why: string }

const LABEL: Record<NeedKey, string> = { ai: "AI", search: "Web search", apollo: "Apollo" };

export async function needs(keys: NeedKey[]): Promise<{ list: Need[]; ok: boolean; blocker: string | null }> {
  if (process.env.ADAPTER_MODE === "mock" || process.env.ABM_TEST_COPY === "true") return { list: keys.map((k) => ({ key: k, label: LABEL[k], state: "on", why: "Sample services" })), ok: true, blocker: null };
  const [states, paused] = await Promise.all([integrationKeyStates(), aiPause()]);
  const aiReady = Boolean(states.get("openrouter")?.ready);
  const list = keys.map((k): Need => {
    if (k === "ai") return { key: k, label: LABEL[k], state: !aiReady ? "off" : paused ? "waiting" : "on", why: !aiReady ? "No AI key yet" : paused ? "AI is paused" : "On" };
    const s = states.get(k);
    if (!s?.ready) return { key: k, label: LABEL[k], state: "off", why: `No ${LABEL[k]} key yet` };
    if (!s.enabled) return { key: k, label: LABEL[k], state: "off", why: `${LABEL[k]} is switched off` };
    if (k === "search" && (!aiReady || paused)) return { key: k, label: LABEL[k], state: "waiting", why: "Waits for the AI" };
    return { key: k, label: LABEL[k], state: "on", why: "On" };
  });
  const first = list.find((n) => n.state !== "on");
  return { list, ok: !first, blocker: first ? `${first.why}. Switch it on in Admin → Integrations.` : null };
}
