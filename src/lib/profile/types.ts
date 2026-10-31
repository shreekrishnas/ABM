// What the AI reader returns for each part of a company profile. Every item carries the exact
// sentence it rests on; code then checks the numbers and names are really in that sentence.

export type ProfileKind = "financials" | "funding" | "tech_stack" | "board";

export const PROFILE_KINDS: ProfileKind[] = ["financials", "funding", "tech_stack", "board"];

export const PROFILE_LABEL: Record<ProfileKind, string> = {
  financials: "Revenue and profit",
  funding: "Funding rounds",
  tech_stack: "Technology stack",
  board: "Board and advisers",
};

export interface FinancialItem {
  page: number;
  /** As written: "FY2024-25", "year ended 31 March 2025", "2024". Annual figures only. */
  fiscalYear: string;
  /** "INR", "USD", "₹", "Rs" … */
  currency: string;
  /** The unit the page uses for these numbers: units | thousand | lakh | million | crore | billion. */
  unit: string;
  revenue: number | null;
  netProfit: number | null;
  ebitda: number | null;
  /** true = consolidated group figures; false = standalone; null = not stated. */
  consolidated: boolean | null;
  quote: string;
}

export interface FundingItem {
  page: number;
  /** As written: "Series B", "seed", "pre-IPO", "debt" … */
  round: string;
  amount: number | null;
  currency: string | null;
  unit: string;
  /** YYYY-MM-DD or YYYY-MM when stated; else null (the page date is used). */
  announced: string | null;
  investors: string[];
  leadInvestors: string[];
  quote: string;
}

export interface TechItem {
  page: number;
  /** Product as written ("Oracle NetSuite", "Salesforce Sales Cloud"). Never a category word alone. */
  tool: string;
  /** uses | implemented | migrating_to | migrating_from | hiring_for */
  context: "uses" | "implemented" | "migrating_to" | "migrating_from" | "hiring_for";
  quote: string;
}

export interface BoardItem {
  page: number;
  name: string;
  /** Role as written ("Independent Director", "Chairman", "Strategic Adviser"). */
  role: string;
  /** board_member | independent_director | adviser | investor | executive_director */
  type: "board_member" | "independent_director" | "adviser" | "investor" | "executive_director";
  quote: string;
}

export type ProfileItems = { financials: FinancialItem[]; funding: FundingItem[]; tech_stack: TechItem[]; board: BoardItem[] };
