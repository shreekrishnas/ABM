// Shape of a seller profile. One profile per company running ABM on the platform.

export type BuyingRoleKey = "decision_maker" | "champion" | "influencer" | "budget_owner";

export interface SellerProfile {
  id: string;
  name: string;
  website: string;
  hq: string;
  founded: number;
  summary: string;
  positioning: string;
  products: { name: string; what: string }[];
  useCases: { key: string; name: string; pains: string; outcome: string }[];
  proofPoints: { text: string; source: string }[];
  customers: { name: string; story: string; publicReference: boolean }[];
  competitors: { name: string; category: "mdm" | "integration" | "workflow" | "lowcode" | "kyc_esign"; angle: string }[];
  icp: {
    industries: { key: string; label: string; tier: "primary" | "secondary"; match: string[]; partnerIntensity: number; useCases: string[] }[];
    employees: { sweetSpot: number; mid: number; min: number };
    geos: { primary: string[]; secondary: string[] };
    tech: { erp: string[]; incumbents: string[]; workflow: string[] };
    weights: { industry: number; size: number; geography: number; partnerNetwork: number; techStack: number };
  };
  personas: { role: BuyingRoleKey; functions: string[]; titles: string[]; why: string }[];
  triggers: { key: string; label: string; keywords: string[]; why: string }[];
  negativeSignals: string[];
  researchQuestions: { key: string; question: string; importance: "high" | "medium" | "low" }[];
  messaging: { cta: string; byUseCase: Record<string, string>; default: string };
  sender: { company: string; name: string; address: string };
}
