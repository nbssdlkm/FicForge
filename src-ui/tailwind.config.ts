import type { Config } from 'tailwindcss'

// Colors are exposed as `rgb(var(--color-X-rgb) / <alpha-value>)` so that
// Tailwind can synthesize alpha for `text-accent/40`, `bg-error/10`, etc.
// The matching `--color-X-rgb` (space-separated R G B triplet) lives in
// `src/App.css` next to the hex form; both must agree.
// `rule` / `rule-soft` stay as direct vars because they are already rgba —
// Tailwind can still apply them but `/N` modifiers are a no-op on them.
const alphaColor = (token: string) => `rgb(var(--color-${token}-rgb) / <alpha-value>)`

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: alphaColor('bg'),
        surface: alphaColor('surface'),
        text: alphaColor('text'),
        'ink-muted': alphaColor('ink-muted'),  // v13: solid #4A5A4F (light) / #95988F (dark) — sharper than text-text/60
        'ink-faint': alphaColor('ink-faint'),  // v13: solid #8B9A8F (light) / #545652 (dark)
        accent: alphaColor('accent'),
        success: alphaColor('success'),
        warning: alphaColor('warning'),
        error: alphaColor('error'),
        info: alphaColor('info'),
        // Ex Libris additions
        drawer: alphaColor('drawer'),              // sage 深绿 — drawer banner / modal header bg
        gold: alphaColor('gold'),                  // antique — gold 文字 on parchment
        'gold-bright': alphaColor('gold-bright'),  // brass — gold 线 on drawer
        'inv-text': alphaColor('inv-text'),        // cream — 深色表面上的文字
        rule: 'var(--color-rule)',                 // pre-mixed rgba, opacity modifiers n/a
        'rule-soft': 'var(--color-rule-soft)',     // pre-mixed rgba, opacity modifiers n/a
      },
      fontFamily: {
        // 通过 CSS 变量解析，运行时可动态切换而无需重新渲染组件。
        // 变量默认值定义在 App.css :root 里，hook 通过 setProperty 覆盖。
        // 注意：Tailwind 要求 fontFamily 值是数组；单元素包裹 CSS var 即可。
        serif: ['var(--font-reading)'],
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
        display: ['var(--font-display)'],  // EB Garamond italic — brand / hero / chapter heading
      },
      spacing: {
        // Based on 4px grid requirements (but keeping arbitrary values mapped to normal tailwind keys)
        // Tailwind default spacing covers 4, 8, 12, 16, 24, 32, 48 (as 1, 2, 3, 4, 6, 8, 12)
        // We will stick to the default spacing scale and utilize p-1, p-2, p-3, p-4, p-6, p-8, p-12 properly.
      },
      borderRadius: {
        'xs': '2px',
        'sm': '4px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
      },
      opacity: {
        // Ex Libris "paper-tint" step — used for banner / card tone fills
        // (InlineBanner info/warning, active Nav / Chapter list items).
        // Tailwind's default scale skips from /5 to /10; /8 matches the
        // design-system-exlibris-v2.html spec (8% fill on tone color).
        '8': '0.08',
      },
      boxShadow: {
        'subtle': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'medium': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'strong': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      }
    },
  },
  plugins: [],
} satisfies Config
