import type { Config } from 'tailwindcss'

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        text: 'var(--color-text)',
        accent: 'var(--color-accent)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        info: 'var(--color-info)',
      },
      fontFamily: {
        // 通过 CSS 变量解析，运行时可动态切换而无需重新渲染组件。
        // 变量默认值定义在 App.css :root 里，hook 通过 setProperty 覆盖。
        // 注意：Tailwind 要求 fontFamily 值是数组；单元素包裹 CSS var 即可。
        serif: ['var(--font-reading)'],
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      spacing: {
        // Based on 4px grid requirements (but keeping arbitrary values mapped to normal tailwind keys)
        // Tailwind default spacing covers 4, 8, 12, 16, 24, 32, 48 (as 1, 2, 3, 4, 6, 8, 12)
        // We will stick to the default spacing scale and utilize p-1, p-2, p-3, p-4, p-6, p-8, p-12 properly.
      },
      borderRadius: {
        'sm': '4px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
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
