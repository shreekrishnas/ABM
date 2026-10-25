// The mark: "ABM" drawn as one piece. The A and the B share a single upright, set in
// violet and standing slightly taller than the letters: the account that marketing and
// sales both build around. Flat geometry, two colours, no effects.

const GLYPH = [
  "M2 36L15 4h4v10.2L8.6 36z",
  "M11.6 24H19v6h-9.9z",
  "M25 4h4.5a9 9 0 0 1 6.2 15.5A9 9 0 0 1 31 36h-6v-6h6a3 3 0 0 0 0-6h-6v-6h4.5a3 3 0 0 0 0-6H25z",
  "M42 36V4h6.2L55 17.6 61.8 4H68v32h-6V16.6l-4.4 9.2h-5.2L48 16.6V36z",
];
export const INK = "#1C1B17";
export const PAPER = "#F4F1EA";
export const ACCENT = "#2FA38C";

function Glyph({ color }: { color: string }) {
  return (
    <>
      <g fill={color}>{GLYPH.map((d) => <path key={d} d={d} />)}</g>
      <rect x="19" y="1" width="6" height="38" fill={ACCENT} />
    </>
  );
}

/** The letters alone, for lockups. Height sets the size. */
export function LogoType({ height = 28, tone = "ink" }: { height?: number; tone?: "ink" | "paper" }) {
  return (
    <svg height={height} width={(height * 68) / 40} viewBox="0 0 68 40" aria-hidden className="brand-type">
      <Glyph color={tone === "ink" ? "var(--brand-ink, #1C1B17)" : PAPER} />
    </svg>
  );
}

/** Square app mark (rail, favicon): the letters on an ink tile. */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="11" fill={INK} />
      <g transform="translate(7 13.4) scale(0.5)"><Glyph color={PAPER} /></g>
    </svg>
  );
}

/** Letters + descriptor. `tone="light"` for dark backgrounds. */
export function Logo({ height = 24, sub, tone = "auto", className }: { height?: number; sub?: string; tone?: "auto" | "light"; className?: string }) {
  return (
    <span className={`brand-lockup${tone === "light" ? " light" : ""}${className ? ` ${className}` : ""}`} aria-label="ABM">
      <LogoType height={height} tone={tone === "light" ? "paper" : "ink"} />
      {sub && <span className="brand-sub">{sub}</span>}
    </span>
  );
}
