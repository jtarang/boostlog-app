---
name: theme-palette-system
description: How theming/palettes work in static/app and static/landing, and the pending enterprise-palette decision
metadata:
  type: project
---

boostLog (static/app + static/landing) has two independent appearance axes on `<html>`:
- `data-theme` = `dark` (default) | `light` — persisted to localStorage key `bl_theme`
- `data-palette` = `original` (default/neon) | `blue` | `violet` | `graphite` — persisted to key `bl_palette`

Both keys are **shared** between app and landing, and both are applied by a no-FOUC inline `<script>` in each `index.html` `<head>` before paint. App logic lives in `static/app/modules/theme.js` (wired via `data-action` registry in main.js); landing logic is inline in `static/landing/main.js`. Charts redraw on a `themechange` window event.

**Token architecture (how to add/change a palette):** colors are CSS vars in `:root`. Overlays use alpha triples — `rgba(var(--fg-rgb), x)` (neutral, flips with theme), `rgba(var(--accent-rgb), x)`, `rgba(var(--danger-rgb), x)`. Brand gradient = `--brand-grad` (+ `--grad` on landing). A palette is just a `[data-palette="x"]` block overriding `--accent`/`--accent-rgb`/`--danger`/`--danger-rgb`/`--success`/`--brand-grad`. Do NOT reintroduce hardcoded `rgba(131,56,236,…)`, `rgba(255,0,110,…)`, or literal brand hexes — use the tokens.

**Logo:** the boostLog mark (three ascending slanted bars) is a reusable inline SVG `<symbol id="bl-mark">` defined once per page (top of `<body>`), used via `<svg class="bl-mark"><use href="#bl-mark"/></svg>`. The two front bars are `fill="currentColor"` (so `.bl-mark { color: var(--text-primary/--text) }` makes them theme-adaptive) and the tall bar is `style="fill:var(--accent)"` (palette-adaptive). Standalone fixed-color file at `static/logo_boostlog.svg` for favicon/OG. Don't put the old `turbo_logo_dark.png` back into brand lockups — it's only retained for the favicon and the FAB / AI-drawer action icons.

**Pending decision (as of 2026-05-29):** user is evaluating the 3 enterprise palettes via the picker in app Settings → Appearance to replace the neon default. Once they pick one, the agreed follow-up is to **tone down the neon glows** (box-shadow bloom, FAB pulse, logo drop-shadows) for an enterprise look — that was promised but not yet done. The switcher only swaps colors, not glow intensity.
