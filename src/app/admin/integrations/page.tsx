import { PageHeader, ago } from "@/components/ui";
import { integrations, type IntegrationState } from "@/lib/admin/integrations";
import { INTEGRATION_KEYS, integrationKeyStates } from "@/lib/integration-keys";
import { aiPause } from "@/lib/admin/ai-pause";
import { getMe } from "@/lib/me";
import { IntegrationCard } from "./card";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

const STATE: Record<IntegrationState, { word: string; cls: string }> = {
  connected: { word: "On", cls: "ok" },
  paused: { word: "Waiting", cls: "warn" },
  setup: { word: "Needs a key", cls: "info" },
  off: { word: "Off", cls: "off" },
  planned: { word: "Coming soon", cls: "off" },
  sample: { word: "Sample data", cls: "warn" },
};

// Which card each key set belongs to (the visitor sync follows Apollo's key and switch).
const CARD_KEYS: Record<string, string> = { openrouter: "openrouter", search: "search", apollo: "apollo", email: "email" };

/** Every connection in one place: a switch to turn it on or off, and its keys typed in place. */
export default async function IntegrationsPage() {
  const [list, keys, paused, me] = await Promise.all([integrations(), integrationKeyStates(), aiPause(), getMe()]);
  const canEdit = Boolean(me?.superAdmin);
  const live = list.filter((i) => i.state === "connected").length;
  return (
    <div className="page-enter">
      <PageHeader eyebrow="Admin" title="Integrations" sub={`${live} of ${list.length} on. ${canEdit ? "Switch each one on or off; when a key is needed, type it in and it is saved encrypted." : "Only a Super Admin can switch these or add keys."}`} />
      <div className="ig-grid">
        {list.map((i) => {
          const spec = INTEGRATION_KEYS.find((s) => s.key === CARD_KEYS[i.key]);
          const k = spec ? keys.get(spec.key) : undefined;
          // A switch only where there is something to switch: OpenRouter follows the AI pause; the others their own setting.
          const on = !spec || !k ? null : spec.key === "openrouter" ? k.ready && !paused : k.ready && k.enabled;
          const state: IntegrationState = k && !k.ready && i.state !== "sample" ? "setup" : spec && k && k.ready && !k.enabled && spec.key !== "openrouter" ? "off" : spec?.key === "search" && on && !keys.get("openrouter")?.ready ? "paused" : i.state;
          // Web search reads pages with the AI: on, but waiting, until OpenRouter has its key.
          const waitsForAi = spec?.key === "search" && on && !keys.get("openrouter")?.ready;
          const technical = /[A-Z]{3,}_[A-Z_]+/.test(i.detail);
          let detail = spec && k && !k.ready ? "Add the key to switch this on." : technical ? (i.key === "visitors-sync" ? "Follows Apollo: works once Apollo has its key and is on." : "") : i.detail;
          if (waitsForAi) detail = "Also needs the OpenRouter key: the AI reads the pages search finds.";
          return (
            <IntegrationCard
              key={i.key}
              id={spec?.key ?? i.key}
              name={i.name}
              what={i.what}
              state={STATE[state].cls}
              stateWord={spec?.key === "openrouter" && state === "paused" ? "Paused" : !spec && state === "setup" ? "Not set up" : STATE[state].word}
              detail={detail}
              last={i.lastLabel ? (i.last ? `${i.lastLabel} ${ago(i.last)}` : `${i.lastLabel}: never`) : ""}
              note={spec?.note}
              on={on}
              ready={k?.ready ?? false}
              fields={k?.fields ?? []}
              anyOf={spec?.anyOf}
              canEdit={canEdit}
            />
          );
        })}
      </div>
    </div>
  );
}
