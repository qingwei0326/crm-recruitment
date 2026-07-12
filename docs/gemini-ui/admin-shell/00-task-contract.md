# Admin shell redesign task

You are redesigning the visual shell of an operational admissions CRM. Return production React code, not a mockup.

## Allowed outputs

Return exactly these three complete files and no others:

1. `frontend/src/components/AdminLayout.jsx`
2. `frontend/src/components/AdminSidebar.jsx`
3. `frontend/src/components/PageHeader.jsx`

Each file is under 400 lines, so return the complete file in a separate fenced code block headed by its exact repository path.

## Required behavior

- Preserve every exported name, prop, route, label, permission check, theme action, logout action, mobile overlay action, and child render point described in `read-only-contract.md`.
- Use only existing React, React Router, Tailwind, and Lucide dependencies.
- Keep the interface quiet, compact, and optimized for repeated CRM work.
- Support desktop, mobile navigation, light mode, and dark mode.
- Include visible focus, hover, active, disabled, and selected states where applicable.
- Keep cards at 8px radius or less and avoid decorative gradients, orbs, marketing layouts, and nested cards.

## Forbidden

- No hardcoded users, metrics, students, routes, or API responses.
- No new routes, dependencies, event buses, state managers, data fetching, or global configuration.
- No changes to `App.jsx`, API modules, hooks, permissions, Tailwind config, or `index.css`.
- No Node, Python, or PowerShell scripts. No bulk overwrite or deletion commands.

Begin with a rationale of at most 200 Chinese characters, then output exactly three complete code files.
