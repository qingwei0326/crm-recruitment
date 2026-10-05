# Shared visual specification

- Product character: quiet, utilitarian, trustworthy, and work-focused.
- Density: compact enough for repeated scanning; no oversized hero typography or decorative section cards.
- Palette: neutral gray surfaces, blue primary actions, green success, amber warning, red danger; do not let one hue dominate the whole interface.
- Typography: normal letter spacing, compact headings, tabular numbers where metrics are shown.
- Shape: 4px to 8px radius (`rounded`/`rounded-md`/`rounded-lg`) for controls; admin panels/surfaces use the `rounded-panel` token (12px), matching existing `AdminSurface`. Do not introduce `rounded-2xl` for new panels.
- Tokens (defined in `tailwind.config.js`): `bg-surface-page`, `text-2xs` (11px), `text-3xs` (10px), `shadow-panel`, `shadow-panel-dark`, `rounded-panel`. Arbitrary values for these are blocked by ESLint.
- Navigation: stable 240px desktop sidebar; clear active marker; labels and icons remain visible; long navigation scrolls without moving account actions.
- Header: 56px desktop baseline; mobile safe-area support; actions remain reachable without overlapping the title.
- Mobile: minimum 40px controls, coherent overlay, no horizontal page overflow.
- Dark mode: preserve readable contrast and avoid pure-black large surfaces.
- Motion: short functional transitions only; reduced-motion is handled globally by a `prefers-reduced-motion` rule in `index.css`; no per-component work needed.
