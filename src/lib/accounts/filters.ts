// The Companies list filters, shared by the page and its export so both return the same companies.
import type { Prisma } from "@prisma/client";

export const SIZES = [
  { value: "1-200", label: "1–200", min: 1, max: 200 },
  { value: "201-1000", label: "201–1,000", min: 201, max: 1000 },
  { value: "1001-5000", label: "1,001–5,000", min: 1001, max: 5000 },
  { value: "5001-20000", label: "5,001–20,000", min: 5001, max: 20000 },
  { value: "20001+", label: "20,000+", min: 20001, max: undefined },
];
export const STAGES = ["UNAWARE", "AWARE", "ENGAGED", "MQA", "OPPORTUNITY", "CUSTOMER", "WATCH", "DISQUALIFIED"] as const;

export type SP = Record<string, string | undefined>;

/** Prisma filter for the Companies list from its URL parameters. */
export function accountWhere(sp: SP): Prisma.AccountWhereInput {
  const and: Prisma.AccountWhereInput[] = [{ mergedIntoId: null }];
  const q = sp.q?.trim();
  if (q) and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }] });
  if (sp.industry) and.push({ industry: sp.industry });
  if (sp.tech) and.push({ technologies: { has: sp.tech } });
  const size = SIZES.find((s) => s.value === sp.size);
  if (size) and.push({ employees: { gte: size.min, ...(size.max ? { lte: size.max } : {}) } });
  if (sp.country) and.push({ country: sp.country });
  if (sp.source) and.push({ source: sp.source });
  if (sp.list) and.push({ lastImportBatchId: sp.list });
  if (sp.campaign) and.push({ contacts: { some: { journeys: { some: { campaignId: sp.campaign } } } } });
  if (sp.tier === "T1" || sp.tier === "T2" || sp.tier === "T3") and.push({ tier: sp.tier });
  if (sp.stage && (STAGES as readonly string[]).includes(sp.stage)) and.push({ stage: sp.stage as (typeof STAGES)[number] });
  if (sp.owner === "none") and.push({ ownerId: null });
  else if (sp.owner) and.push({ ownerId: sp.owner });
  if (sp.hot === "1") and.push({ intentReading: { path: ["level"], equals: "hot" } });
  if (sp.nopeople === "1") and.push({ contacts: { none: {} } });
  if (sp.rel === "customer" || sp.rel === "competitor") and.push({ relationship: sp.rel });
  const minIntent = Number(sp.intent) || 0;
  if (minIntent > 0) and.push({ intentScore: { gte: minIntent } });
  return { AND: and };
}
