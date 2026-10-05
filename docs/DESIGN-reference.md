# Trilliant Dashboard — Global Design System

> **Purpose.** This is the single source of truth for the visual language of the
> Trilliant MoM / SMM / Ajna dashboards. Feed this document to any coding agent and
> it should be able to produce screens that look identical to the existing app —
> same colours, same cards, same radii, same search bars, same dark mode. **When a
> value here conflicts with ad-hoc code, this document wins; always prefer the CSS
> tokens below over hard-coded hex.**

Design language: **Glassmorphism** — translucent frosted surfaces, a soft blurred
radial-gradient "atmosphere", layered depth, generous rounding, and light **and** dark
themes that flip via CSS variables.

Stack it targets: **React 19 + Vite + Tailwind v4** (`@import "tailwindcss"`), styling
via a mix of **global CSS utility classes** (in `index.css`) and **inline `style={{}}`
objects that reference `var(--token)`**. Charts: **Recharts v3**. Motion: light
`framer-motion` + CSS keyframes. Icons: **inline SVG only** (no icon font, no emoji
as UI icons).

---

## 1 · Theming model (read this first)

Two themes, toggled by setting `data-theme="dark"` on `<html>` (light = no attribute).
**Every colour that must adapt is a CSS variable.** Components reference `var(--token)`
inline so dark mode flips automatically. **Never hard-code a white background or a dark
text colour on a surface** — use the tokens, or dark mode breaks (white glare / invisible text).

### Semantic tokens

| Token                       | Light                      | Dark                       | Use for                                   |
| --------------------------- | -------------------------- | -------------------------- | ----------------------------------------- |
| `--text-primary`          | `#1E1B4B`                | `#F1F5F9`                | headings, key values                      |
| `--text-secondary`        | `#475569`                | `#CBD5E1`                | body text, labels                         |
| `--text-muted`            | `#9CA3AF`                | `#94A3B8`                | captions, meta, placeholders              |
| `--text-on-accent`        | `#FFFFFF`                | `#FFFFFF`                | text on coloured buttons                  |
| `--surface-base`          | `#FFFFFF`                | `#0F172A`                | page base                                 |
| `--surface-card`          | `rgba(255,255,255,0.85)` | `rgba(30,41,59,0.85)`    | cards, panels, inputs                     |
| `--surface-card-elevated` | `rgba(255,255,255,0.95)` | `rgba(51,65,85,0.95)`    | sticky headers, raised rows, active chips |
| `--surface-card-header`   | `rgba(0,0,0,0.02)`       | `rgba(255,255,255,0.04)` | table toolbars, subtle tint               |
| `--surface-input`         | `#FFFFFF`                | `rgba(15,23,42,0.6)`     | form fields                               |
| `--surface-hover`         | `rgba(0,0,0,0.04)`       | `rgba(255,255,255,0.06)` | row/item hover                            |
| `--border-subtle`         | `rgba(0,0,0,0.06)`       | `rgba(255,255,255,0.08)` | hairlines, card borders                   |
| `--border-default`        | `rgba(0,0,0,0.10)`       | `rgba(255,255,255,0.14)` | dividers                                  |
| `--border-input`          | `#E5E7EB`                | `rgba(255,255,255,0.16)` | field borders                             |
| `--accent-primary`        | `#7C3AED`                | `#7C3AED`                | brand purple (CTAs, active)               |
| `--accent-primary-soft`   | `rgba(124,58,237,0.08)`  | `rgba(165,180,252,0.12)` | tinted accent fills                       |
| `--accent-section`        | `#7C3AED`                | `#A5B4FC`                | section labels                            |
| `--status-success`        | `#10B981`                | (same)                     | done / positive                           |
| `--status-warning`        | `#F59E0B`                | (same)                     | pending / caution                         |
| `--status-danger`         | `#DC2626`                | (same)                     | overdue / delete                          |
| `--status-info`           | `#0EA5E9`                | (same)                     | info / secondary                          |

### Layout constants

`--sidebar-width: 96px` · `--topbar-height: 72px`.

### Dark-mode safety net

`index.css` has `[data-theme="dark"] .app-main …` rules that force headings/`p`/`div`/
`span` text light **except** elements whose class contains `badge`/`btn` or that carry
an inline `background`. **Implication for agents:** coloured pills/badges must set their
own inline `background` (so their text colour is preserved); plain text must rely on
tokens (so the safety net can flip it).

---

## 2 · Brand & accent palette

| Name                   | Hex         | Role                                                                                                                        |
| ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Brand Purple** | `#7C3AED` | Primary brand accent — gradient CTAs, active tabs, "Super Admin", Exec Brief. Gradient partners `#4F46E5` / `#6D28D9`. |
| **Indigo**       | `#6366F1` | Component primary (`.btn-primary`, focus ring, sidebar active). Gradient partner `#4F46E5`.                             |
| Sky                    | `#0EA5E9` | info / Ajna-PPC accent                                                                                                      |
| Emerald                | `#10B981` | success                                                                                                                     |
| Amber                  | `#F59E0B` | warning                                                                                                                     |
| Pink                   | `#F472B6` | decorative                                                                                                                  |
| Violet                 | `#8B5CF6` | "in review"                                                                                                                 |
| Navy                   | `#1E1B4B` | deep brand text                                                                                                             |

### Signature gradients

- **Primary CTA / brand mark:** `linear-gradient(135deg, #7C3AED, #4F46E5)` (purple→indigo).
- **Logo mark:** `linear-gradient(135deg, #6366F1, #7C3AED)`.
- **Role-badge text (gradient clip):** Super Admin `linear-gradient(135deg,#8B5CF6,#6D28D9)`; other roles `linear-gradient(135deg,#818CF8,#4F46E5)` with `-webkit-background-clip:text; color:transparent`.

### Deterministic "brand colour" for avatars / entity marks

Account & ad-account avatars pick a colour by hashing the id from this fixed palette
(so a given entity is always the same colour):

```
['#6366F1','#0EA5E9','#10B981','#F59E0B','#F472B6','#8B5CF6','#06B6D4','#EF4444']
hash = Σ charCode + ((hash<<5) - hash);  color = palette[abs(hash) % 8]
```

Avatar mark = 2-letter initials, white bold text, `linear-gradient(135deg, color, color+'CC')`, soft `0 8px 20px {color}55` shadow.

### Pod colours

Each pod carries a `color_hex` (fallback `#7C3AED`); pod cards tint with it at low alpha.
Generic seed palette: `#6366F1 / #0EA5E9 / #10B981 / #F59E0B`.

---

## 3 · Atmosphere background

Fixed, blurred multi-radial gradient behind the glass shell (`position:fixed; inset:0; z-index:-1; filter:blur(80px)`).

**Light:**

```
radial-gradient(circle at 20% 20%, #e0e7ff 0%, transparent 40%),
radial-gradient(circle at 80% 10%, #fae8ff 0%, transparent 40%),
radial-gradient(circle at 50% 50%, #f1f5f9 0%, transparent 100%),
radial-gradient(circle at 10% 80%, #dcfce7 0%, transparent 40%),
radial-gradient(circle at 90% 90%, #fef9c3 0%, transparent 40%)
```

**Dark:** same positions with `#1e1b4b / #3b0764 / #0f172a / #064e3b / #1c1917`.

---

## 4 · Typography

- **UI font:** `'Inter', system-ui, -apple-system, sans-serif` (Google Fonts, weights 300–900, antialiased).
- **Display / numeric serif:** `'Fraunces', ui-serif, Georgia, serif` — for large money/KPI figures (billing scorecards, invoice totals). Falls back to Georgia if Fraunces isn't loaded; add the Fraunces `<link>` for an exact match.
- **Weights:** 400 body · 500 labels · 600 secondary buttons/headings · 700 primary buttons/strong · 800–900 page titles & big numbers.
- **Type scale (rem):** captions `0.62–0.72` · meta `0.75–0.82` · body `0.85–0.9375` · sub-head `1.0–1.05` · section `1.25` · page title `1.45–1.75` (weight 800–900, letter-spacing `-0.02em`…`-0.04em`).
- **Uppercase micro-labels:** `0.62–0.68rem`, weight 700, uppercase, `letter-spacing:0.06–0.1em`, colour `--text-muted`.
- **Numbers:** `ui-monospace, monospace` for ids/dates; serif for headline figures; tabular figures for aligned numeric columns.

---

## 5 · Spacing, radius, elevation

**Radius scale (rem):** `0.3` chips · `0.4–0.5` small controls · `0.625` list rows ·
`0.875` **inputs & buttons (default)** · `0.95` topbar avatar · `1–1.1` cards ·
`1.25` standout cards · `1.5` **glass cards (signature)** · `2` shell + modals ·
`9999px` pills / badges / search.

**Spacing:** 4px base; common gaps `0.25 / 0.4 / 0.5 / 0.75 / 1rem`; card padding
`1.1–1.25rem`; page padding `1.5rem 2rem`.

**Shadows / elevation:**

- Card rest: `0 2px 12px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)`
- Card hover: `0 16px 40px rgba(0,0,0,0.10), 0 4px 12px rgba(0,0,0,0.06)` + `translateY(-2px)`
- Elevated pill / control: `0 6px 18px rgba(15,23,42,0.07)`
- Primary CTA: `0 2px 8px rgba(99,102,241,0.35)` → hover `0 6px 20px rgba(99,102,241,0.45)`
- Brand gradient CTA: `0 8px 20px rgba(124,58,237,0.32–0.35)`
- Modal: `0 32px 80px rgba(0,0,0,0.14), 0 8px 24px rgba(99,102,241,0.10), inset 0 1px 0 rgba(255,255,255,0.8)`
- Glass shell: `0 25px 50px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.06)` (dark = heavier black).

---

## 6 · App shell & navigation

```
.app-outer                  full viewport, centers the shell, padding 1rem
  .atmosphere               fixed blurred gradient (z-index:-1)
  .app-shell .glass-panel   max-width 1600px · height 95vh · radius 2rem · overflow hidden
    .sidebar                96px icon rail (transparent, right hairline border)
    .app-content
      .topbar               72px, transparent, bottom hairline
      .app-main             scroll area, padding 1.5rem 2rem, transparent
```

- **Glass panel** (`.glass-panel`): `background:rgba(255,255,255,0.45)`, `backdrop-filter:blur(40px) saturate(160%)`, 1px translucent border. Dark: `rgba(10,10,30,0.88)`.
- **Sidebar item** (`.sidebar-item`): 48×48, radius `0.875rem`, idle `#94A3B8`; hover bg `rgba(255,255,255,0.6)` + `#475569`; **active** bg `#fff`, `#6366F1`, shadow `0 4px 12px rgba(99,102,241,0.20)`; tooltip = dark `::after` chip to the right. Dark active: bg `rgba(99,102,241,0.22)`, `#A5B4FC`.
- **Logo mark:** 44×44 rounded `0.875rem`, indigo→purple gradient, sparkle SVG.
- **Topbar pattern:** left = greeting/title block; right group (`gap:0.75rem`) = round 44–46px theme toggle, optional gradient action pill, role-badge pill, user chip, "Back to App". Full-screen sub-apps (Super Admin, Ajna) reuse this exact topbar.

---

## 7 · Surfaces & cards

| Class                  | Background                 | Blur         | Border                     | Radius     | Shadow       | Notes                              |
| ---------------------- | -------------------------- | ------------ | -------------------------- | ---------- | ------------ | ---------------------------------- |
| `.glass-card`        | `rgba(255,255,255,0.65)` | 16px sat140% | `rgba(255,255,255,0.65)` | `1.5rem` | rest→hover  | hover lifts `-2px`, bg→0.82     |
| `.glass-card-static` | same                       | 16px         | same                       | `1.5rem` | rest only    | non-interactive panels (most used) |
| `.glass-modal`       | `rgba(255,255,255,0.92)` | 40px sat180% | `rgba(255,255,255,0.70)` | `2rem`   | modal shadow | centered dialog                    |

**Custom inline cards** (KPI, account, list rows) still set `background:var(--surface-card)`
(or `-elevated`), `border:1px solid var(--border-subtle)`, a radius from the scale, and
the rest-shadow — never a literal white.

### KPI / stat card

Radius `0.9–1rem`, padding `~1rem 1.1rem`, a **coloured left accent strip**
(`position:absolute; left:0; top:0; bottom:0; width:4px; background:{accent}`) **or** a
`border-top:3px solid {accent}`. Inside: uppercase micro-label (`--text-muted`) → big
value (`1.3–2rem`, weight 800, `--text-primary`) → optional meta line (`--text-muted`).

### Account / entity card (grid item)

Grid `minmax(210–248px,1fr)`, `gap 1–1.25rem`. Card: radius `1–1.25rem`, padding
`1.1–1.25rem`, `var(--surface-card)`, subtle border, rest-shadow; hover `translateY(-3px)`

+ `0 16px 36px rgba(15,23,42,0.12)`. Layout: top row = status dot + name (700) +
  status/"Active" pill; mono id line; meta row (currency · timezone); hairline divider;
  footer = `→ Open` primary + small icon buttons (KB / Agent) **inline** (keep all badges
  in the flex row — never an absolute corner ribbon, which overlaps).

### Pod card (Clients page)

`minmax(248px,1fr)`, radius `1.25rem`, `linear-gradient(155deg, {podColor}1A, var(--surface-card) 58%)`,
dotted radial decoration top-right, 56px gradient avatar, people-count badge, name +
tagline, footer label ("View Clients" / "Open SMM Portal" / "Open PPC Dashboard") + arrow
that nudges on hover.

---

## 8 · Buttons (canonical set)

| Variant                      | Fill                                        | Text        | Radius       | Weight | Shadow                              | When                                      |
| ---------------------------- | ------------------------------------------- | ----------- | ------------ | ------ | ----------------------------------- | ----------------------------------------- |
| `.btn-primary`             | `#6366F1`→hover `#4F46E5`              | white       | `0.875rem` | 700    | indigo glow                         | default primary action                    |
| **Brand gradient CTA** | `linear-gradient(135deg,#7C3AED,#4F46E5)` | white       | `0.85rem`  | 700    | `0 8px 20px rgba(124,58,237,.35)` | hero actions, "Back to App", "Exec Brief" |
| `.btn-secondary`           | `rgba(255,255,255,0.70)` glass            | `#374151` | `0.875rem` | 600    | none                                | secondary; hover bg→0.90                 |
| `.btn-ghost`               | transparent                                 | `#6B7280` | `0.875rem` | 500    | none                                | tertiary                                  |
| `.btn-danger`              | `#EF4444`→`#DC2626`                    | white       | `0.875rem` | 600    | red glow                            | destructive                               |
| `.btn-icon`                | transparent                                 | `#9CA3AF` | `0.625rem` | —     | —                                  | icon-only 36–40px                        |

All buttons: `display:inline-flex; align-items:center; gap:0.4rem; cursor:pointer`;
filled variants `hover translateY(-1px)`; `:disabled { opacity:0.5 }`.

**Elevated pill controls** (navbar search, role badge, "View As", toggles): height
44–46px, `border-radius:9999px`, `background:var(--surface-card)`, `border:1px solid var(--border-subtle)`, shadow `0 6px 18px rgba(15,23,42,0.07)`. The round theme toggle is
a 44–46px circle of the same recipe.

---

## 9 · Inputs & search

- `.glass-input` / `.glass-textarea` / `.glass-select`: `background:rgba(255,255,255,0.5–0.7)`,
  `1.5px` translucent border, radius `0.875rem`, padding `~0.625rem 0.875rem`,
  `backdrop-filter:blur(8px)`. **Focus:** border `#6366F1` + ring `0 0 0 3px rgba(99,102,241,0.15)`.
  Placeholder `#9CA3AF`. Select = custom SVG chevron, `appearance:none`.
- **Search bar (signature):** the pill search. Take a `glass-input`, set
  `border-radius:9999px`, `height:46px`, `padding-left:2.75rem` for the leading search icon,
  add the elevated shadow `0 6px 18px rgba(15,23,42,0.07)`. The navbar search is the
  reference; every "Search …" field matches it.
- **Custom-looking select/picker:** overlay a transparent native `<select>`
  (`position:absolute; inset:0; opacity:0; appearance:none; font-size:16px`) on a styled
  pill (avoids iOS zoom, keeps native a11y).

---

## 10 · Badges, pills & status colours

Pill base (`.badge`): `inline-flex; gap:0.25rem; padding:0.2rem 0.625rem; border-radius:9999px; font-size:0.75rem; font-weight:600; white-space:nowrap`. **Always set an inline `background`**
(dark mode preserves the text colour). Tag/label pills never wrap (`display:inline-block; white-space:nowrap`).

**Task / kanban status** (dot + label colour, bg = colour@`0.08`): To Do `#94A3B8` ·
In Review `#8B5CF6` · In Progress `#0EA5E9` · Blocked `#EF4444` · Completed `#10B981`.

**Badge utility classes:** todo `#EEF2FF/#4338CA` · in_progress `#FFFBEB/#B45309` ·
completed `#ECFDF5/#065F46` · blocked `#FEF2F2/#991B1B` · priority high `#FEF2F2/#991B1B` ·
medium `#FFFBEB/#92400E` · low `#F9FAFB/#4B5563`.

**SMM request status** (text / bg): Input `--text-secondary` / `rgba(100,116,139,0.10)` ·
In Progress `#B45309` / `rgba(245,158,11,0.12)` · On Hold `#7C2D12` / `rgba(234,88,12,0.12)` ·
Review `#1D4ED8` / `rgba(29,78,216,0.10)` · Closed `#166534` / `rgba(22,101,52,0.10)`.

**Risk bands** (Exec Brief): High `#DC2626` on `#FEE2E2` · Medium `#B45309` on `#FEF3C7` ·
Low `#059669` on `#D1FAE5`.

**Source pills:** MoM `#0369A1` / sky tint · Project `#5B21B6` / purple tint · Ad-hoc
`#B45309` / amber tint · Review `#7C3AED` / purple tint.

**Priority left-bar:** `border-left:3px solid` — high `#EF4444`, medium `#F59E0B`, low `#D1D5DB`.

---

## 11 · Tables

Wrap in `.glass-card-static` (`padding:0; overflow:hidden`). Header: uppercase micro-labels
(`0.62–0.68rem`, weight 700, `--text-muted`), `border-bottom:1px solid var(--border-subtle)`;
sticky headers use `background:var(--surface-card-elevated)`. Body rows:
`border-bottom:1px solid rgba(15,23,42,0.04)`, hover `rgba(14,165,233,0.05)` (or
`--surface-hover`), text `--text-primary`/`--text-secondary`. Sortable column = a button
with label + up/down chevron, active colour `#0EA5E9`. **Never** a literal white
header/body — use tokens.

---

## 12 · Tabs

- **Underline tabs** (Super Admin / Ajna / account sub-nav): flex row with
  `border-bottom:1.5px solid var(--border-subtle)`; each tab `padding:0.625rem 1.25rem`,
  active = `border-bottom:2.5px solid {accent}` + accent text + weight 700, inactive =
  `--text-muted` weight 500; `margin-bottom:-1.5px` to overlap the divider.
- **Segmented pill toggle** (filters, "Today/Week/15d", "Open Load/All"): track
  `background:rgba(255,255,255,0.45); border-radius:0.85rem; padding:0.25–0.3rem`; active
  chip `background:var(--surface-card-elevated)` + accent text + small shadow; inactive
  transparent + `--text-muted`. (Active chip must be a token, not `#fff`.)

---

## 13 · Modals

Centered overlay `background:rgba(15,23,42,0.45–0.55)` (full-screen blur); content =
`.glass-modal` (radius `2rem`, 40px blur). Header: optional uppercase accent eyebrow +
title (700). Footer: right-aligned `Cancel` (secondary) + primary action. Confirm before
destructive actions; delete uses a typed-name confirmation step. Modals animate in from
their trigger (scale+fade); dismiss on backdrop click + an explicit close button.

---

## 14 · Avatars & marks

`Avatar` = initials (1–2 letters) on a `linear-gradient(135deg,#6366F1,#4F46E5)` circle,
sizes 28–56px, white bold text; falls back to a provided `src`. Online dot = 11px
`#10B981` with a 2px `--surface-base` ring at bottom-right.

---

## 15 · Iconography

- **Inline SVG only**, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
  `stroke-width:2` (2.2–2.5 for chevrons/arrows), `stroke-linecap/linejoin:round`.
- Sizes: 20px sidebar nav · 13–16px inline/button · 11px micro.
- Heroicons/Lucide-style outline shapes. **No emoji as functional icons** (a sparkle `✦`
  is acceptable as a decorative accent on AI/brief actions only).

---

## 16 · Charts (Recharts v3)

- Token-driven colours; grid `stroke:rgba(15,23,42,0.06)` (vertical off); axis ticks
  `fontSize:11, fill:var(--text-muted)`; tooltip `borderRadius:10, border:1px solid rgba(15,23,42,0.08), fontSize:12`.
- **Area** (e.g. daily spend): single accent (`#0EA5E9`) with a vertical gradient fill
  fading to transparent, `strokeWidth:2`.
- **Donut / distribution:** conic-gradient or Recharts `PieChart` with `innerRadius`;
  legend in a 2-col grid below.
- Stacked horizontal capacity bars = plain `<div>` segments coloured by status
  (amber/slate/red/blue/green) for pixel control.

---

## 17 · Motion

Durations 150–300ms; micro-interactions ≤200ms; ease-out on enter. Keyframes:
`fadeIn`, `slideUp`, `scaleIn (0.96→1)`, `slideInRight`, `slideInUp`, `spin`,
`completionPop (1→1.18→0.95→1)`, `confettiFall`. Utility classes: `.page-enter`
(slide-up-in — use on every page root), `.animate-fade-in/-slide-up/-scale-in`,
`.stagger > *` (40ms incremental child delays for lists/grids). Cards lift `-2/-3px`
on hover. Respect `prefers-reduced-motion`. Never animate `width/height/top/left` —
use `transform`/`opacity`.

---

## 18 · Rules for an implementing agent (checklist)

1. **Use tokens, not hex** for any text/surface/border that must adapt to dark mode.
   Semantic accents (status/brand) may be literal but prefer the maps above.
2. **Cards** = `.glass-card-static`, radius `1.5rem` (or `1–1.25rem` compact), token
   background + subtle border + rest-shadow. Interactive cards add the hover lift.
3. **Buttons:** primary = `.btn-primary`; hero = brand gradient pill; secondary = glass
   pill; destructive = `.btn-danger`. Radius `0.875rem`; pills `9999px`.
4. **Search** = rounded `9999px` glass pill, 46px tall, leading icon, elevated shadow.
5. **Pills/badges:** always set inline `background`; `white-space:nowrap`; radius `9999px`.
6. **Page root** gets `.page-enter`; lists/grids may use `.stagger`.
7. **Tables:** token header/rows, sticky header `--surface-card-elevated`, hover tint.
8. **Tabs:** underline (accent) or segmented pill (token active chip).
9. **Layout:** full-screen tools reuse `app-outer → atmosphere → app-shell.glass-panel → sidebar + app-content (topbar + app-main)`.
10. **Icons:** inline SVG, stroke 2, currentColor. **No emoji UI icons.**
11. **Dark mode:** test it — if a panel glows white or text vanishes, you hard-coded a
    colour instead of a token. Fix at the token, not with a one-off override.
12. **Fonts:** Inter everywhere; Fraunces (Georgia fallback) for big money/KPI numbers;
    mono for ids/dates; tabular figures for aligned numeric columns.

---
