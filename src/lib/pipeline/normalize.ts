// Pure normalization helpers used by stage 2. No database access.

const LEGAL_SUFFIXES = /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|plc|gmbh|ag|sa|s\.a|pvt|private|corp|corporation|co|bv|b\.v|oy|ab|srl|pty)\.?$/i;

export function normalizeDomain(input?: string | null): string | null {
  if (!input) return null;
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z]+:\/\//, "");
  d = d.replace(/^www\d?\./, "");
  d = d.split(/[/?#]/)[0];
  d = d.split(":")[0];
  d = d.replace(/\.+$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null;
  return d;
}

export function normalizeCompanyName(input: string): string {
  let name = input.trim().replace(/\s+/g, " ").replace(/[,]+$/, "");
  // Strip repeated legal suffixes ("Acme Holdings Pvt Ltd" → "Acme Holdings").
  for (let i = 0; i < 3; i++) {
    const next = name.replace(/[,\s]+$/, "").replace(LEGAL_SUFFIXES, "").replace(/[,\s]+$/, "");
    if (next === name || !next) break;
    name = next;
  }
  return name;
}

const TITLE_ABBREVIATIONS: [RegExp, string][] = [
  [/\bhd\b/gi, "Head"],
  [/\bsr\b\.?/gi, "Senior"],
  [/\bjr\b\.?/gi, "Junior"],
  [/\bmgr\b/gi, "Manager"],
  [/\bdir\b\.?/gi, "Director"],
  [/\beng\b\.?/gi, "Engineering"],
  [/\bops\b/gi, "Operations"],
  [/\bmktg\b/gi, "Marketing"],
  [/\bvp\b/gi, "VP"],
  [/\bsvp\b/gi, "SVP"],
  [/\bevp\b/gi, "EVP"],
];

const TITLE_KEEP_UPPER = new Set(["VP", "SVP", "EVP", "CEO", "CTO", "CFO", "CIO", "COO", "CMO", "CISO", "CDO", "CRO", "CPO", "IT", "HR", "AI", "ML", "BI"]);

export function standardizeTitle(input?: string | null): string | null {
  if (!input) return null;
  let t = input.trim().replace(/\s+/g, " ");
  if (!t) return null;
  for (const [re, rep] of TITLE_ABBREVIATIONS) t = t.replace(re, rep);
  return t
    .split(" ")
    .map((w) => {
      const up = w.toUpperCase();
      if (TITLE_KEEP_UPPER.has(up)) return up;
      if (["of", "and", "&", "for", "the"].includes(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

const FUNCTION_RULES: [RegExp, string][] = [
  [/\b(ciso|security|infosec)\b/i, "security"],
  [/\b(cdo|data|analytics|bi|machine learning|ml|ai)\b/i, "data"],
  [/\b(cfo|finance|financial|controller|accounting|fp&a)\b/i, "finance"],
  [/\b(cto|engineering|developer|software|platform|devops|architect)\b/i, "engineering"],
  [/\b(cio|it|information technology|infrastructure|systems)\b/i, "it"],
  [/\b(cmo|marketing|growth|demand|brand)\b/i, "marketing"],
  [/\b(cro|sales|revenue|account executive|business development)\b/i, "sales"],
  [/\b(coo|operations|supply chain|logistics)\b/i, "operations"],
  [/\b(hr|people|talent|recruit)\b/i, "hr"],
  [/\b(ceo|founder|president|owner|managing director)\b/i, "executive"],
];

export function inferFunction(title?: string | null): string | null {
  if (!title) return null;
  for (const [re, fn] of FUNCTION_RULES) if (re.test(title)) return fn;
  return null;
}

export function inferSeniority(title?: string | null): string | null {
  if (!title) return null;
  if (/\b(chief|ceo|cto|cfo|cio|coo|cmo|ciso|cdo|cro|cpo|founder|president)\b/i.test(title)) return "c_level";
  if (/\b(vp|svp|evp|vice president)\b/i.test(title)) return "vp";
  if (/\b(head|director)\b/i.test(title)) return "director";
  if (/\b(manager|lead|principal)\b/i.test(title)) return "manager";
  return "ic";
}

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

export function isValidEmail(email?: string | null): boolean {
  if (!email) return false;
  const e = email.trim();
  return EMAIL_RE.test(e) && !e.includes("..") && e.split("@").length === 2;
}

export function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return e || null;
}

export function emailDomain(email?: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  return email.split("@")[1]?.toLowerCase() ?? null;
}

/** E.164-ish validation: + followed by 8–15 digits after stripping separators. */
export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[\s().-]/g, "");
  if (!/^\+?\d{8,15}$/.test(digits)) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

const DIAL_CODES: Record<string, string> = {
  "1": "US", "44": "GB", "91": "IN", "49": "DE", "33": "FR", "31": "NL", "61": "AU", "65": "SG", "353": "IE", "34": "ES", "39": "IT", "46": "SE",
};

export function phoneCountry(phone?: string | null): string | null {
  const p = normalizePhone(phone);
  if (!p) return null;
  const d = p.slice(1);
  for (const len of [3, 2, 1]) {
    const c = DIAL_CODES[d.slice(0, len)];
    if (c) return c;
  }
  return null;
}

export function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function normalizeLinkedin(url?: string | null): string | null {
  if (!url) return null;
  const m = url.trim().toLowerCase().match(/linkedin\.com\/in\/([a-z0-9-_%]+)/);
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

export function normalizeCountry(input?: string | null): string | null {
  if (!input) return null;
  const s = input.trim().toUpperCase();
  const map: Record<string, string> = {
    "UNITED STATES": "US", USA: "US", "U.S.": "US", "UNITED KINGDOM": "GB", UK: "GB", ENGLAND: "GB", INDIA: "IN", GERMANY: "DE",
    FRANCE: "FR", NETHERLANDS: "NL", CANADA: "CA", AUSTRALIA: "AU", SINGAPORE: "SG", IRELAND: "IE", SPAIN: "ES", ITALY: "IT", SWEDEN: "SE",
  };
  if (map[s]) return map[s];
  return /^[A-Z]{2}$/.test(s) ? s : null;
}
