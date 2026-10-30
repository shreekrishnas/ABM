// "Why now" text for people: the reasons the brain joined with "; and ", one per item,
// with ISO dates written as "1 Oct" and no dangling dashes.

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

export function whyNowReasons(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/;\s*and\s+/)
    .map((r) =>
      r
        .replace(/\((\d{4})-(\d{2})-(\d{2})\)/g, (_, _y: string, m: string, d: string) => `(${Number(d)} ${MONTH[Number(m) - 1] ?? m})`)
        .replace(/\s*[—–-]\s*$/, "")
        .trim(),
    )
    .filter(Boolean)
    .map((r) => r.charAt(0).toUpperCase() + r.slice(1));
}

/** The first reason, and how many more there are. */
export function whyNowShort(text: string | null | undefined): { first: string | null; more: number } {
  const r = whyNowReasons(text);
  return { first: r[0] ?? null, more: Math.max(0, r.length - 1) };
}
