// The mark: "t." — a drawn lowercase t on an ink tile, with the full stop as a square.
// The crossbar ends in a 45° cut (the trilliant cut); the foot of the t turns toward the
// full stop: many signals, one account, found. Flat, two colours, no effects, so it holds
// up at 16px and on paper.

export function LogoMark({ size = 40, className, tone = "ink" }: { size?: number; className?: string; tone?: "ink" | "paper" }) {
  const tile = tone === "ink" ? "#1E1240" : "#F4F1FB";
  const glyph = tone === "ink" ? "#F4F1FB" : "#1E1240";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="12" fill={tile} />
      <path d="M15.5 8h7v21a4 4 0 0 0 4 4h3v7h-3c-6.08 0-11-4.92-11-11V8z" fill={glyph} />
      <path d="M10.5 15h22l-6 7h-16z" fill={glyph} />
      <rect x="32.5" y="33" width="7" height="7" fill="#A855F7" />
    </svg>
  );
}

/** Mark + wordmark. `tone="light"` for dark backgrounds. */
export function Logo({ size = 36, sub, tone = "auto", className }: { size?: number; sub?: string; tone?: "auto" | "light"; className?: string }) {
  return (
    <span className={`brand-lockup${tone === "light" ? " light" : ""}${className ? ` ${className}` : ""}`}>
      <LogoMark size={size} tone={tone === "light" ? "paper" : "ink"} />
      <span className="brand-words">
        <span className="brand-name">trilliant<span className="brand-dot" aria-hidden /></span>
        {sub && <span className="brand-sub">{sub}</span>}
      </span>
    </span>
  );
}
