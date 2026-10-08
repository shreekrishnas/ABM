# ABM Design System v2

**Built on:** the Trilliant glass system (`docs/DESIGN-reference.md`). Its tokens, theming model, radii, atmosphere, buttons, inputs, tables and tabs all still apply.
**What v2 changes:** how screens are organised and how they read. v1 shows how the system works; v2 shows what a person should do next.

---

## 1 · Principles (in priority order)

1. **One screen, one job.** Each page answers a single question:
   - Today: what needs me?
   - Company: should we act, and how?
   - Person: where are they with us?
2. **Action first.** Every list item has exactly one action, written as a verb ("Book the call", "Review", "Send the details"). Detail is still there, but folded away.
3. **Plain words.** Never show internal names ("stage 11", "critic panel", "probable", "MQA"). Use the glossary in §6.
4. **Colour means one thing.** Intent and signal colours are fixed (§3) and never used for decoration.
5. **Glass for chrome, solid for reading.** The shell, sidebar, topbar, pills and modals stay glass. Anything people read for more than a line sits on `--surface-read`, which is near-solid with no blur.
6. **Show why.** Any score or verdict links to its reasons (why now, signals, case for and against). If a number can't explain itself, it doesn't go on screen.

## 2 · Information architecture

| Group | Items | Notes |
|---|---|---|
| **Work** | Today (`/`), Companies, People, Approvals & checks, Emails | Daily use |
| **Flow** | Import, Signals, Hand-offs to sales, Behind the scenes (`/pipeline`) | Data in and audit |
| **CRM** | Opportunities, Tasks | |
| **Results** | Program overview (`/overview`), Analytics, Settings | |

- The sidebar keeps the 92px icon rail. v2 adds group labels above each cluster; they are hidden on mobile.
- The brain has no page. Its output appears where people act: Today, the company hero and the person's journey.

## 3 · Tokens added in v2 (light / dark)

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--surface-read` | `rgba(255,255,255,.90)` | `rgba(22,30,48,.92)` | reading surface, no blur |
| `--intent-hot` | `#E11D48` | `#FB7185` | 2+ independent signals converging |
| `--intent-warm` | `#D97706` | `#FBBF24` | some signal, not converged |
| `--intent-cold` | `#64748B` | `#94A3B8` | quiet |
| `--ok` / `--wait` / `--stop` | `#059669` / `#B45309` / `#DC2626` | lighter tints | done / needs a person / blocked |
| `--fam-trigger` | `#4F46E5` | `#818CF8` | market event |
| `--fam-conversation` | `#0A66C2` | `#60A5FA` | LinkedIn conversation |
| `--fam-programme` | `#7C3AED` | `#A78BFA` | programme in the seller's space |
| `--fam-hiring` | `#0D9488` | `#2DD4BF` | hiring in the owning team |
| `--fam-leadership` | `#C2410C` | `#FB923C` | new decision maker |
| `--fam-engagement` | `#DB2777` | `#F472B6` | clicks, visits, replies |
| `--fam-negative` | `#DC2626` | `#F87171` | risk |
| `--ring` | `0 0 0 3px rgba(99,102,241,.22)` | same | focus and current step |

Tinted fills use `color-mix(in srgb, var(--c) 12%, transparent)`, so one token works in both themes.

## 4 · Components (`src/components/v2.tsx`, CSS in `globals.css` under "v2")

| Component | Use | Anatomy |
|---|---|---|
| `QueueRow` | One item that needs a person | 4px rail coloured by kind · optional avatar · title (650) · 2-line sub · chips · verb action with arrow. The whole row is the link. |
| `SectionLabel` | Heads a queue | uppercase micro label + count + hairline that runs to the edge |
| `IntentPill` | Buying intent | dot + Hot/Warm/Quiet + score; `title` holds the explanation |
| `FamilyChip` | A signal's family | square-ish chip (radius .5rem), so it reads differently from status pills |
| `Stepper` | Progress along a path | done = green filled · current = indigo ring · upcoming = muted |
| `NextAction` | The single next step on an entity page | soft brand gradient panel, label "Next best action", one sentence, one line of why |
| `StatStrip` | 3–5 headline numbers | one row with hairline separators; Fraunces numerals; replaces rows of KPI cards on entity pages |
| `.hero` / `.read` | Entity header, reading cards | `--surface-read`, radius 1.5rem |
| `details.more` | Secondary detail | chevron disclosure; collapsed by default |

Status pills (`.badge`) are unchanged from v1. Use them for states (Ready, Blocked). Use chips for kinds (Trigger, Hiring).

## 5 · Page patterns

**Today:**
- Greeting with how many things need you.
- A stat strip.
- Two columns of queues:
  - Left (conversations): replies to answer, follow-ups due.
  - Right (decisions): hot companies, emails to approve, decisions needed.
- Empty queues show a dashed "all clear" row, never a blank space.

**Company:**
- Hero: name, facts, actions.
- Buying intent (pill, signal chips, why now), then Next best action, then a stat strip.
- Tabs underneath for the evidence.

**Person:**
- Prospect journey: stepper, intent panel, filterable timeline (kind label in its colour, title, detail, date · who did it).
- The LinkedIn journey per sender stays below.

## 6 · Language glossary

| Internal | On screen |
|---|---|
| MQA | Sales-ready |
| RECYCLED | Back in research |
| probable | likely |
| stale | outdated |
| unknown (field) | unchecked |
| conflicting | conflict |
| stage 4 / 9 / 11 … | identity check / contact check / writer … |
| Pipeline | Behind the scenes |
| Review queue | Approvals & checks |
| Outreach | Emails |
| intent cold | Quiet |

## 7 · Rules for implementers (in addition to v1 §18)

1. **New lists of work use `QueueRow`.** Tables are for browsing data, not for to-dos.
2. **Every entity page shows its next action above the fold.**
3. **No raw enum or step names in the UI.** Map them through the glossary.
4. **Never use an intent or family colour for decoration.**
5. **Reading cards add `read`** (`glass-card-static read`). Don't stack blur on blur.
6. **Check both themes and a 390px width before shipping.**

## 8 · v3 layout layer (references: Linear, Superhuman, Stripe via awesome-design-md)

The **look** stays exactly the Trilliant glass system: tokens, atmosphere, glass shell, radii, gradients, Inter + Fraunces. The references guide only **layout, icons and how features are shown**:

- **Labelled sidebar.** The sidebar is 232px with a brand block (logo mark and seller name), group labels, and an icon and label on each item. Counts sit right-aligned; Approvals uses a red count. Between 900 and 1100px wide it collapses to the 92px icon rail; on mobile it moves to a bottom bar. Item recipe from the spec: active = white background, indigo text and glow.
- **One action per row** (Superhuman). Each queue row ends in a small glass pill button that fills with indigo on hover. Never more than one.
- **Meaning by dot, not fill** (Linear). Signal chips are neutral glass pills with a small coloured dot, so a row of four signals reads calmly. Only intent (Hot / Warm / Quiet) uses a filled tint.
- **Numbers** (Stripe). Tabular figures; one stat strip per page instead of a grid of KPI cards.

## 9 · Each section has its own view

Each section is shown the way its content works, not as one more list. Every page keeps a **List** switch (`ViewSwitch`, top-right) for the detail view.

| Section | Default view | Why |
|---|---|---|
| Today | Queues with one action each | It's a to-do list |
| Companies | **Priority map**: fit across, buying intent up, four named quadrants (Act now · Signals, weaker fit · Great fit, quiet · Park). Mark size = tier; red ring = hot. | Where to spend time is a position, not a row |
| People | **Journey board**: 8 lanes (Not contacted → Invited → Connected → Talking → Interested → Meeting → Opportunity · Parked), one card per person and sender | Progress is movement across a path |
| Approvals | **One at a time**: the top email as an editable card, its checks as chips, Approve & next / Reject, and the rest stacked behind with an "Up next" list | Approving is a sequence of decisions |
| Emails | **Conversations**: people on the left; on the right, the whole thread as bubbles (ours on the right, theirs on the left; email and LinkedIn together) with each email's status | An email only makes sense in its conversation |
| Import | **Step rail**: five numbered steps; done = green tick, current = brand gradient | It's a path with an end |
| Company / Person | Hero with intent and next action; journey timeline | One entity, one story |
