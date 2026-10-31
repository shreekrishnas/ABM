// Money, units and fiscal years, exactly. Companies report "₹12,345.6 crore", "$1.2 bn",
// "Rs 4,567 Cr" or "INR 45,678 million" for the same kind of number; everything here turns
// those into one absolute amount in one currency, and back into the way people read it.

/** Approximate conversion to US dollars, for comparing company sizes only (never shown as exact). */
export const FX_TO_USD: Record<string, number> = {
  USD: 1, INR: 0.012, EUR: 1.08, GBP: 1.27, AED: 0.272, SAR: 0.267, QAR: 0.275, OMR: 2.6, KWD: 3.25, BHD: 2.65,
  SGD: 0.74, MYR: 0.21, IDR: 0.000063, PHP: 0.017, THB: 0.028, VND: 0.000039, AUD: 0.66, NZD: 0.6, JPY: 0.0067,
  CNY: 0.14, HKD: 0.128, KRW: 0.00073, CAD: 0.73, CHF: 1.13, SEK: 0.095, NOK: 0.093, DKK: 0.145, ZAR: 0.055, BRL: 0.18,
};

export type Unit = "units" | "thousand" | "lakh" | "million" | "crore" | "billion" | "trillion";

export const UNIT_FACTOR: Record<Unit, number> = { units: 1, thousand: 1e3, lakh: 1e5, million: 1e6, crore: 1e7, billion: 1e9, trillion: 1e12 };

const UNIT_WORDS: [RegExp, Unit][] = [
  [/^(trillion|tn|trn)$/i, "trillion"],
  [/^(billion|bn|bln|b)$/i, "billion"],
  [/^(crores?|cr|crs)$/i, "crore"],
  [/^(million|mn|mln|mio|m)$/i, "million"],
  [/^(lakhs?|lacs?|lac|lk)$/i, "lakh"],
  [/^(thousand|k|thou)$/i, "thousand"],
];

export function parseUnit(raw: string | null | undefined): Unit {
  const w = (raw ?? "").trim().replace(/\.$/, "");
  if (!w) return "units";
  for (const [re, u] of UNIT_WORDS) if (re.test(w)) return u;
  return (Object.keys(UNIT_FACTOR) as Unit[]).includes(w.toLowerCase() as Unit) ? (w.toLowerCase() as Unit) : "units";
}

const CURRENCY_MARKS: [RegExp, string][] = [
  [/₹|\brs\.?(?=\s|\d)|\binr\b|\brupees?\b/i, "INR"],
  [/\bus\$|\busd\b|\bus dollars?\b/i, "USD"],
  [/€|\beur\b|\beuros?\b/i, "EUR"],
  [/£|\bgbp\b|\bpounds? sterling\b/i, "GBP"],
  [/\baed\b|\bdirhams?\b/i, "AED"],
  [/\bsar\b|\briyals?\b/i, "SAR"],
  [/\bs\$|\bsgd\b/i, "SGD"],
  [/\ba\$|\baud\b/i, "AUD"],
  [/¥|\bjpy\b|\byen\b/i, "JPY"],
  [/\brmb\b|\bcny\b|\byuan\b/i, "CNY"],
  [/\$/, "USD"],
];

/** ISO code from a symbol, code or word ("₹", "Rs", "INR", "rupees" → INR). Null when unclear. */
export function parseCurrency(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^[A-Z]{3}$/.test(s) && FX_TO_USD[s]) return s;
  for (const [re, code] of CURRENCY_MARKS) if (re.test(s)) return code;
  return null;
}

export function toAbsolute(amount: number | null | undefined, unit: Unit): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  return amount * UNIT_FACTOR[unit];
}

export function toUsd(absolute: number | null | undefined, currency: string | null | undefined): number | null {
  if (absolute == null || !currency) return null;
  const rate = FX_TO_USD[currency.toUpperCase()];
  return rate ? absolute * rate : null;
}

/** Every number written in a piece of text, as read by a person ("12,345.6" → 12345.6; Indian grouping too). */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ""))).filter((n) => Number.isFinite(n));
}

/**
 * True when `amount` (in the unit the source used) is actually written in the quote.
 * This is the guard against invented figures: a revenue the page doesn't state is dropped.
 */
export function amountInQuote(amount: number | null | undefined, quote: string | null | undefined): boolean {
  if (amount == null || !quote) return false;
  const target = Math.abs(amount);
  return numbersIn(quote).some((n) => (target === 0 ? n === 0 : Math.abs(n - target) / target <= 0.005));
}

/**
 * Fiscal year as one key: the calendar year the fiscal year ENDS in.
 * "FY25", "FY2024-25", "2024-25", "FY 2025", "year ended 31 March 2025", "2024" → "FY2025" (or "FY2024").
 */
export function normFiscalYear(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const range = s.match(/(20\d{2}|19\d{2})\s*[-–/]\s*(\d{2,4})/);
  if (range) {
    const start = Number(range[1]);
    const endRaw = range[2];
    const end = endRaw.length === 2 ? Math.floor(start / 100) * 100 + Number(endRaw) : Number(endRaw);
    if (end === start + 1) return `FY${end}`;
  }
  const fy = s.match(/fy\s*'?\s*(\d{2,4})/i);
  if (fy) {
    const y = fy[1].length === 2 ? 2000 + Number(fy[1]) : Number(fy[1]);
    if (y > 1990 && y < 2100) return `FY${y}`;
  }
  const year = s.match(/\b(19\d{2}|20\d{2})\b(?!.*\b(19\d{2}|20\d{2})\b)/);
  if (year) return `FY${year[1]}`;
  return null;
}

const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

/** How people read the amount: rupees in crore (₹12,346 Cr), everything else in M / B. */
export function formatAmount(absolute: number | null | undefined, currency: string | null | undefined): string {
  if (absolute == null || !currency) return "—";
  const sym = SYMBOL[currency] ?? `${currency} `;
  const neg = absolute < 0 ? "−" : "";
  const v = Math.abs(absolute);
  if (currency === "INR") {
    if (v >= 1e7) return `${neg}${sym}${(v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: v >= 1e10 ? 0 : 1 })} Cr`;
    if (v >= 1e5) return `${neg}${sym}${(v / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`;
    return `${neg}${sym}${v.toLocaleString("en-IN")}`;
  }
  if (v >= 1e9) return `${neg}${sym}${(v / 1e9).toFixed(v >= 1e11 ? 0 : 1)}B`;
  if (v >= 1e6) return `${neg}${sym}${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
  if (v >= 1e3) return `${neg}${sym}${Math.round(v / 1e3)}k`;
  return `${neg}${sym}${Math.round(v)}`;
}

export function formatUsd(v: number | null | undefined): string {
  return formatAmount(v ?? null, "USD");
}
