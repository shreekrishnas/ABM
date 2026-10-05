// Server-safe UI primitives that follow docs/DESIGN-reference.md.
import type { ReactNode } from "react";
import Link from "next/link";
import type { BuyingStage, FieldStatus, Tier } from "@prisma/client";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// Pills always set an inline background so dark mode keeps their colour.
export function Badge({ color, bg, children, dot, title }: { color: string; bg?: string; children: ReactNode; dot?: boolean; title?: string }) {
  return (
    <span className="badge" title={title} style={{ color, background: bg ?? hexA(color, 0.1) }}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const STAGE_STYLE: Record<BuyingStage, { color: string; label: string }> = {
  UNAWARE: { color: "#64748B", label: "Unaware" },
  AWARE: { color: "#0EA5E9", label: "Aware" },
  ENGAGED: { color: "#8B5CF6", label: "Engaged" },
  MQA: { color: "#7C3AED", label: "MQA" },
  OPPORTUNITY: { color: "#4F46E5", label: "Opportunity" },
  CUSTOMER: { color: "#059669", label: "Customer" },
  WATCH: { color: "#B45309", label: "Watch" },
  DISQUALIFIED: { color: "#DC2626", label: "Disqualified" },
  RECYCLED: { color: "#0891B2", label: "Recycled" },
};

export function StageBadge({ stage }: { stage: BuyingStage }) {
  const s = STAGE_STYLE[stage];
  return <Badge color={s.color} dot>{s.label}</Badge>;
}

export const TIER_COLOR: Record<Tier, string> = { T1: "var(--chart-1)", T2: "var(--chart-2)", T3: "var(--chart-3)" };
const TIER_HEX: Record<Tier, string> = { T1: "#4F46E5", T2: "#0D9488", T3: "#C2410C" };

export function TierBadge({ tier }: { tier: Tier | null }) {
  if (!tier) return <span className="muted text-xs">—</span>;
  return (
    <span className="badge" style={{ color: TIER_HEX[tier], background: hexA(TIER_HEX[tier], 0.1) }}>
      {tier} · {tier === "T1" ? "1:1" : tier === "T2" ? "1:few" : "1:many"}
    </span>
  );
}

export const FIELD_STATUS_STYLE: Record<FieldStatus, string> = {
  verified: "#059669",
  probable: "#0D9488",
  conflicting: "#DC2626",
  stale: "#B45309",
  invalid: "#991B1B",
  unknown: "#64748B",
};

export function FieldBadge({ status }: { status: FieldStatus | undefined | null }) {
  const s = status ?? "unknown";
  return <Badge color={FIELD_STATUS_STYLE[s]} dot>{s}</Badge>;
}

const AVATAR_PALETTE = ["#6366F1", "#0EA5E9", "#10B981", "#F59E0B", "#F472B6", "#8B5CF6", "#06B6D4", "#EF4444"];

export function brandColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function Avatar({ name, id, size = 36, round = false }: { name: string; id?: string; size?: number; round?: boolean }) {
  const c = brandColor(id ?? name);
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center font-bold text-white"
      style={{
        width: size, height: size, fontSize: size * 0.36, borderRadius: round ? 9999 : size * 0.3,
        background: `linear-gradient(135deg, ${c}, ${c}CC)`, boxShadow: `0 6px 16px ${c}44`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function Kpi({ label, value, meta, accent, icon }: { label: string; value: ReactNode; meta?: ReactNode; accent?: string; icon?: ReactNode }) {
  return (
    <div className="kpi" style={{ ["--kpi-accent" as string]: accent ?? "var(--accent-indigo)" }}>
      <div className="flex items-center justify-between">
        <span className="micro">{label}</span>
        {icon && <span style={{ color: accent ?? "var(--accent-indigo)" }}>{icon}</span>}
      </div>
      <div className="value display-num tnum">{value}</div>
      {meta && <div className="meta">{meta}</div>}
    </div>
  );
}

export function Card({ title, sub, action, children, className, pad = true }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("glass-card-static", pad && "card-pad", className)}>
      {(title || action) && (
        <div className={cx("card-head", !pad && "px-5 pt-5")}>
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow?: string; title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="secondary mt-1.5 max-w-3xl text-sm">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, sub, action }: { icon?: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 grid h-12 w-12 place-items-center rounded-2xl" style={{ background: "var(--accent-primary-soft)", color: "var(--accent-section)" }}>{icon}</div>}
      <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</div>
      {sub && <div className="muted max-w-sm text-xs">{sub}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Meter({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="track" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <i style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function TabLinks({ tabs, active, base }: { tabs: { id: string; label: string; count?: number }[]; active: string; base: string }) {
  return (
    <nav className="tabs mb-5">
      {tabs.map((t) => (
        <Link key={t.id} href={`${base}${base.includes("?") ? "&" : "?"}tab=${t.id}`} className={cx("tab", active === t.id && "active")} scroll={false}>
          {t.label}
          {t.count != null && <span className="ml-1.5 tnum text-xs opacity-70">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function money(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n.toLocaleString()}`;
}

export function ago(d: Date | string | null | undefined) {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d) : d;
  const s = (Date.now() - t.getTime()) / 1000;
  const abs = Math.abs(s);
  const fmt = (v: number, u: string) => `${Math.round(v)}${u}`;
  const str = abs < 60 ? "just now" : abs < 3600 ? fmt(abs / 60, "m") : abs < 86400 ? fmt(abs / 3600, "h") : abs < 86400 * 30 ? fmt(abs / 86400, "d") : t.toISOString().slice(0, 10);
  if (str === "just now" || str.includes("-")) return str;
  return s >= 0 ? `${str} ago` : `in ${str}`;
}

export function date(d: Date | string | null | undefined) {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d) : d;
  return t.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
