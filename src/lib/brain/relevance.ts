// Client Relevance Map: offering → problem solved → observable business conditions → use case →
// buyer → disconfirming evidence. Built from the client's own profile, versioned with it. It
// guides the investigation; it is not a keyword list that decides intent.

import type { SellerProfile } from "@/lib/seller/types";
import type { RelevanceMap } from "./research-types";

export function relevanceMap(sp: SellerProfile, version: string): RelevanceMap {
  return {
    client: sp.name,
    version,
    offerings: sp.products.map((p) => ({ name: p.name, what: p.what, useCases: p.useCases ?? [] })),
    useCases: sp.useCases.map((u) => {
      const triggers = sp.triggers.filter((t) => t.useCase === u.key);
      const buyers = [...new Set(sp.personas.filter((p) => p.role === "decision_maker" || p.role === "champion").flatMap((p) => p.functions))];
      return {
        key: u.key,
        problem: u.pains,
        outcome: u.outcome,
        // Conditions you could observe from outside that make the problem likely.
        observable: triggers.length ? triggers.map((t) => `${t.label}: ${t.why}`) : sp.triggers.slice(0, 3).map((t) => t.label),
        buyers,
        // What would show the need is already met or absent.
        disconfirming: [
          ...sp.competitors.slice(0, 4).map((c) => `already uses ${c.name} (${c.category}) for this`),
          "the programme is finished, cancelled or fully staffed by another supplier",
          "the change does not touch the processes this offering serves",
        ],
      };
    }),
    disqualifiers: [
      ...(sp.icp.mustHave?.countries?.length ? [`outside ${sp.icp.mustHave.countries.join("/")}`] : []),
      ...(sp.icp.mustHave?.minEmployees ? [`fewer than ${sp.icp.mustHave.minEmployees} employees`] : []),
      ...sp.negativeSignals,
    ],
  };
}

/** Short text form for prompts. */
export function relevanceText(m: RelevanceMap): string {
  return [
    `CLIENT: ${m.client} (profile v${m.version})`,
    `OFFERINGS: ${m.offerings.map((o) => `${o.name} — ${o.what}${o.useCases.length ? ` [${o.useCases.join(", ")}]` : ""}`).join(" | ")}`,
    ...m.useCases.map((u) => `USE CASE ${u.key}: problem = ${u.problem}; outcome = ${u.outcome}; observable conditions = ${u.observable.join("; ")}; buyers = ${u.buyers.join(", ") || "?"}; disconfirming = ${u.disconfirming.join("; ")}`),
    m.disqualifiers.length ? `DISQUALIFIERS: ${m.disqualifiers.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}
