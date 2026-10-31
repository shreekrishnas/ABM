// Stakeholder map: every group that shapes an enterprise purchase, not only the CEO and the
// buyer. Each group has the job titles used to search for it and a rule that files an existing
// person into it from their title. Board members, investors and advisers come from board research.

export interface StakeholderGroup {
  key: string;
  label: string;
  /** What this group usually decides or blocks. */
  role: string;
  /** Titles to search a contact provider with (most senior first). */
  titles: string[];
  /** Files a person into the group from their title. Checked in GROUP_ORDER. */
  match: RegExp;
}

export const STAKEHOLDER_GROUPS: StakeholderGroup[] = [
  { key: "executive", label: "Leadership", role: "Sets priorities and signs off large programmes", titles: ["Chief Executive Officer", "Managing Director", "Founder", "Co-Founder", "President", "Executive Director"], match: /\b(ceo|chief executive|managing director|founder|co-founder|president|whole[- ]time director|executive director|\bmd\b)\b/i },
  { key: "it_digital", label: "IT and digital", role: "Owns the systems decision, integration and security review", titles: ["Chief Information Officer", "Chief Technology Officer", "Chief Digital Officer", "Head of IT", "IT Director", "VP Information Technology"], match: /\b(cio|cto|cdio|chief (information|technology|digital)|head of (it|technology|digital|applications)|it (head|director|manager)|vp (it|technology|engineering)|enterprise architect)\b/i },
  { key: "finance", label: "Finance", role: "Approves the budget and owns payment and audit outcomes", titles: ["Chief Financial Officer", "Finance Director", "VP Finance", "Financial Controller", "Head of Accounts Payable", "Head of Finance"], match: /\b(cfo|chief financial|finance|financial controller|controller|accounts payable|treasur|accounting)\b/i },
  { key: "procurement", label: "Procurement", role: "Runs vendor selection and owns supplier data and risk", titles: ["Chief Procurement Officer", "Head of Procurement", "VP Procurement", "Head of Sourcing", "Head of Vendor Management", "Purchase Head"], match: /\b(cpo|chief procurement|procurement|sourcing|purchas|vendor management|supplier management)\b/i },
  { key: "operations", label: "Operations and supply chain", role: "Feels the process pain day to day; can stall or speed adoption", titles: ["Chief Operating Officer", "Head of Operations", "Head of Supply Chain", "VP Supply Chain", "Plant Head", "Head of Manufacturing"], match: /\b(coo|chief operating|operations|supply chain|plant head|plant manager|manufacturing|logistics|warehouse)\b/i },
  { key: "data", label: "Data and master data", role: "Owns data quality and governance; usually the hands-on champion", titles: ["Chief Data Officer", "Head of Master Data", "Master Data Manager", "Data Governance Lead", "Head of SAP Centre of Excellence", "Master Data Lead"], match: /\b(master data|data governance|chief data|data office|data management|sap (coe|centre of excellence|center of excellence)|centre of excellence|center of excellence)\b/i },
  { key: "risk_compliance", label: "Risk, audit and compliance", role: "Can block on controls; a strong ally when the case is risk reduction", titles: ["Head of Internal Audit", "Chief Risk Officer", "Chief Compliance Officer", "Company Secretary", "Head of Legal", "Head of Information Security"], match: /\b(audit|risk|compliance|company secretary|legal|general counsel|ciso|information security)\b/i },
  { key: "sales_channel", label: "Sales and channel", role: "Owns distributors, dealers and partner growth", titles: ["Chief Sales Officer", "Head of Sales", "Head of Distribution", "VP Channel Sales", "National Sales Head", "Head of Channel Partnerships"], match: /\b(sales|distribution|channel|commercial|business development|key account|trade marketing)\b/i },
  { key: "hr", label: "People and HR", role: "Owns workforce onboarding and its compliance", titles: ["Chief Human Resources Officer", "Head of HR", "VP Human Resources", "Head of Talent Acquisition"], match: /\b(chro|chief (human|people)|human resources|\bhr\b|talent acquisition|people (officer|operations))\b/i },
];

/** Most specific first: "Data Governance Lead" is data, not risk; "Finance Director" is finance, not leadership. */
const GROUP_ORDER = ["data", "it_digital", "procurement", "finance", "operations", "risk_compliance", "sales_channel", "hr", "executive"];

export const GROUP_BY_KEY = Object.fromEntries(STAKEHOLDER_GROUPS.map((g) => [g.key, g])) as Record<string, StakeholderGroup>;

export function groupOf(title: string | null | undefined): string | null {
  const t = (title ?? "").trim();
  if (!t) return null;
  for (const k of GROUP_ORDER) if (GROUP_BY_KEY[k].match.test(t)) return k;
  return null;
}

/** Function words the seller's personas use → stakeholder groups. */
const FUNCTION_GROUP: Record<string, string> = { it: "it_digital", engineering: "it_digital", security: "risk_compliance", data: "data", finance: "finance", procurement: "procurement", operations: "operations", sales: "sales_channel", marketing: "sales_channel", hr: "hr", executive: "executive", legal: "risk_compliance", compliance: "risk_compliance" };

/**
 * Groups to cover for a seller, most important first: the groups its personas name, then leadership,
 * finance, procurement, operations and IT (present in almost every enterprise purchase), then the rest.
 */
export function targetGroups(personaFunctions: string[]): string[] {
  const fromPersonas = personaFunctions.map((f) => FUNCTION_GROUP[f]).filter(Boolean);
  return [...new Set([...fromPersonas, "executive", "finance", "procurement", "operations", "it_digital", "data", "risk_compliance", "sales_channel", "hr"])];
}

export interface MappedPerson { id: string; fullName: string; title: string | null; buyingRole: string; stakeholderType: string; discoveredBy: string | null }

/** People per group, plus the board (directors, investors, advisers) as its own group. */
export function stakeholderMap(people: MappedPerson[], groups: string[]) {
  const board = people.filter((p) => p.stakeholderType !== "executive");
  const staff = people.filter((p) => p.stakeholderType === "executive");
  const rows = groups.map((k) => ({ group: GROUP_BY_KEY[k], people: staff.filter((p) => groupOf(p.title) === k) }));
  const unfiled = staff.filter((p) => !groupOf(p.title) || !groups.includes(groupOf(p.title)!));
  return { rows, board, unfiled, covered: rows.filter((r) => r.people.length).length, total: rows.length };
}

/** Titles that are the obvious buyers: an "additional influencer" must not be one of these. */
export const OBVIOUS_TITLE = /\b(ceo|chief executive|cfo|chief financial|cio|chief information|cto|chief technology|coo|chief operating|managing director|founder|chairman|chairperson|president)\b/i;

/** Word overlap between two titles (0–1), to spot a proposed role the company already has. */
export function titleOverlap(a: string, b: string): number {
  const w = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((x) => x.length > 2 && !["head", "lead", "senior", "manager", "director", "the", "and", "for"].includes(x)));
  const A = w(a);
  const B = w(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}
