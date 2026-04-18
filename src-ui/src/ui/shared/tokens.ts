// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * FicForge design tokens.
 *
 * Semantic names mapped to CSS custom properties defined in `App.css` and
 * `tailwind.config.ts`. Prefer these over hardcoded hex/px values when writing
 * inline styles, animations, or any JS-side color/layout access.
 *
 * Theme swapping (warm / mint / night) happens via `.theme-*` classes on
 * `<html>` rewriting the CSS vars — TS consumers automatically follow.
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
