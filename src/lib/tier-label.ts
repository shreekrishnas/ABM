// Plain words for the priority tiers. The stored values stay T1 / T2 / T3; only what people read changes.
export const TIER_LABEL: Record<string, string> = { T1: "Top priority", T2: "Mid priority", T3: "Broad" };
export const TIER_HELP: Record<string, string> = { T1: "Personal, one-to-one outreach", T2: "Small-group outreach", T3: "Broad outreach" };
export const tierLabel = (t: string | null | undefined) => (t ? TIER_LABEL[t] ?? t : "");
