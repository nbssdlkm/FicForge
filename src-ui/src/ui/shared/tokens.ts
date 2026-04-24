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
 * BRAND CAVEAT (Ex Libris)
 * ────────────────────────────────────────────────────────────────────────────
 * 现行视觉为 Ex Libris (sage drawer + olive accent + gold metadata)，色板由
 * 用户画师朋友给定。只有两种主题：
 *   warm  (Light):  accent #576148 olive · drawer #47594E sage
 *   night (Dark):   accent #4D5741 olive · drawer #3F5048 sage
 *
 * Mint 主题 2026-04 已退役；ThemeToggle 持久化 key 仍叫 ficforge_theme 但
 * 只认 'warm' | 'night'，旧存的 'mint' 会 fallback 到 'warm'。
 *
 * Do NOT hardcode the hex anywhere in JS/TS; always go through this
 * indirection so themes stay coherent.
 */

/** Semantic color tokens. Values reference CSS vars to respect the active theme. */
export const color = {
  surface: {
    /** Page / app root background */
    base: 'var(--color-bg)',
    /** Raised surfaces: cards, sidebars, inline banner backgrounds */
    raised: 'var(--color-surface)',
    /** Drawer / modal header bg (sage in light, dark sage in night) — Ex Libris signature surface */
    drawer: 'var(--color-drawer)',
  },
  text: {
    /** Default body text */
    default: 'var(--color-text)',
    /** "Inverse" text — used on dark surfaces (drawer / accent button bg) */
    inv: 'var(--color-inv-text)',
  },
  /** Brand primary — action / 选中态 (olive in Ex Libris) */
  accent: 'var(--color-accent)',
  /** Gold (Ex Libris signature) */
  gold: {
    /** Antique gold — text / 描边 on parchment surfaces */
    antique: 'var(--color-gold)',
    /** Polished brass — gold lines on drawer/dark surfaces */
    bright: 'var(--color-gold-bright)',
  },
  /** Semantic status colors, tuned for light + dark visibility */
  status: {
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    error: 'var(--color-error)',
    info: 'var(--color-info)',
  },
  /** Hairline / divider tints (green-tinted on parchment, cream-tinted on charcoal). */
  rule: {
    /** 1px hairlines — card borders, dividers, input underlines */
    default: 'var(--color-rule)',
    /** Subtle fills — hover bg, dashed dividers, soft chips */
    soft: 'var(--color-rule-soft)',
  },
} as const;

/**
 * Gold line thickness — drawer banner / modal header inset shadow.
 * Used in box-shadow as: `inset 0 var(--gold-top-thick) 0 var(--color-gold-bright)` etc.
 */
export const goldLine = {
  topThick: 'var(--gold-top-thick)',
  bottomThick: 'var(--gold-bottom-thick)',
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
