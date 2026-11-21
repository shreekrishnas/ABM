# 09 · UI and UX design audit

## Strengths [Code]
- **Design tokens are enforced:**
  - Semantic tokens in `src/app/design.css`, with a dark theme.
  - `npm run lint:tokens` blocks new raw colours or px font sizes, and the build runs this check.
- **Consistent shell:** a rail on desktop and a bottom bar on phones.
- **Navigation aids:** breadcrumbs, a command palette, and keyboard list navigation.
- **Honest UI copy:**
  - "why" boxes (Why this email, Why now);
  - confidence tags and source links on facts;
  - empty and waiting states that explain what's happening.
- **Accessibility basics:**
  - A skip link and a global `:focus-visible` ring.
  - About 370 `aria-*` attributes, `aria-current` on navigation, and labels on icon buttons.
  - `prefers-reduced-motion` is honoured.
- **Undo toasts** for reversible actions.

## Inconsistencies and debt [Code]
- **Two token systems.** `globals.css` holds older tokens and about 60 dark-mode rules with raw hex. `design.css` is the newer, clean one.
- **Two component layers.** `ui.tsx` and `v2.tsx` duplicate parts of `components/kit`, and the kit is barely used.
- **About 25 breakpoints** with no shared scale.
- **Mixed styling approaches.** Tailwind utilities, BEM-style classes (`sh-*`, `pp-*`, `jo-*`, `tm-*`) and inline styles (for example the loading skeleton) are used side by side.
- **Unused font packages** in `package.json`. [Assumption]
- **A hard-coded person's name** in the "access removed" gate text (`src/components/shell/Shell.tsx`, about line 33). Replace it with a generic contact.

## Accessibility risks [Verify]
- Custom dialogs (palette, quick task, Vega panel, modals) show no sign of a focus trap or `aria-modal`.
- `AccountMenu` uses `role="menu"` but has no arrow-key navigation.
- Some status is shown by colour alone in the older hex styles.
- There are no automated accessibility tests (axe or similar), and no mobile end-to-end tests.

## Notes from manual visual checks during this engagement [Runtime, local preview]
- Pages were checked in light, dark and phone layouts during the redesigns: Home, Today, Pipeline, People, Audit log and Vega.
- Earlier problems were fixed:
  - menus clipped by cards;
  - the hover card hidden under the hero;
  - text clipped in filter rows.

## Recommendations
1. Move the `globals.css` tokens into `design.css` and delete the raw dark-mode hex rules.
2. Pick one component layer (the kit), then migrate to it or delete the other.
3. Define a breakpoint scale of 4 to 5 tokens.
4. Add a focus trap and `aria-modal` to dialogs, and add axe checks to the e2e tests.
