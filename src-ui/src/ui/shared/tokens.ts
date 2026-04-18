// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * FicForge design tokens — TS mirror of the design system.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS
 * ────────────────────────────────────────────────────────────────────────────
 * A typed reference to FicForge's semantic color / spacing / radius / layout
 * values. All color values point to CSS custom properties (defined in
 * `src-ui/src/App.css` under `.theme-warm / .theme-mint / .theme-night`), so
 * theme switching flows through automatically — no need to re-read the theme.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHEN TO USE
 * ────────────────────────────────────────────────────────────────────────────
 * ✓ Inline `style={{ ... }}` when a value can't be expressed as a Tailwind class
 *     e.g. `<div style={{ maxWidth: layout.readingMaxWidth }}>`
 * ✓ framer-motion / Web Animations API
 *     e.g. `animate={{ color: color.accent }}`
 * ✓ Canvas / SVG where you need color values programmatically
 * ✓ Any hook / utility computing styles in JS
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHEN NOT TO USE
 * ────────────────────────────────────────────────────────────────────────────
 * ✗ When a Tailwind utility class already covers it. Do NOT convert
 *     `className="text-accent"` → `style={{ color: color.accent }}`; the
 *     class is shorter AND respects hover/dark variants. Tailwind classes
 *     are the default; tokens are the escape hatch.
 * ✗ Don't import `color.accent` then append opacity manually. Instead use
 *     Tailwind's `text-accent/50` for opacity variants.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HOW TO ADD / CHANGE A TOKEN
 * ────────────────────────────────────────────────────────────────────────────
 * 1. Change the CSS var in `App.css` (source of truth for colors).
 * 2. Mirror any new semantic field here (TS-side reference).
 * 3. If the token maps to a Tailwind value, also update `tailwind.config.ts`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BRAND CAVEAT
 * ────────────────────────────────────────────────────────────────────────────
 * `color.accent` is `var(--color-accent)` — its actual hex differs per theme
 * (warm: #C5705D / mint: #6BAF7A / night: #C5705D). Do NOT hardcode the hex
 * anywhere in JS/TS; always go through this indirection so themes stay coherent.
 */

/** Semantic color tokens. Values reference CSS vars to respect the active theme. */
export const color = {
  surface: {
    /** Page / app root background */
    base: 'var(--color-bg)',
    /** Raised surfaces: cards, sidebars, inline banner backgrounds */
    raised: 'var(--color-surface)',
  },
  text: {
    /** Default body text */
    default: 'var(--color-text)',
  },
  /** Brand primary — story-anchored accent color */
  accent: 'var(--color-accent)',
  /** Semantic status colors, tuned for light + dark visibility */
  status: {
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    error: 'var(--color-error)',
    info: 'var(--color-info)',
  },
} as const;

/** Spacing scale — matches Tailwind's default 4px grid where possible. */
export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
} as const;

/** Border radius scale — mirrors `tailwind.config.ts` overrides. */
export const radius = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

/** Layout constants that drive feel-of-reading decisions. */
export const layout = {
  /** Writer / reading column cap. Keeps CJK line length in the 60-75 char comfort zone. */
  readingMaxWidth: '720px',
} as const;

export type Spacing = keyof typeof spacing;
export type Radius = keyof typeof radius;
