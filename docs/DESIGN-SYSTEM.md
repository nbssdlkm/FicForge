# FicForge Design System (v2 — Ex Libris)

> Reference for visual design tokens, UI primitives, and contribution conventions.
> Applies to `src-ui/` and any future project reusing these primitives.
> Token 事实源 = `src-ui/src/App.css` + `src-ui/tailwind.config.ts`，本文档跟随其变更。
> 已知外部复用：[nbssdlkm/personal-website](https://github.com/nbssdlkm/personal-website) 的 `src/styles/exlibris.css` 以同名 CSS 变量拷贝 token（手动同步）。

## 1. 哲学

三条原则贯穿所有决策：

1. **阅读优先**（reading-first）—— FicForge 是写作/阅读应用，每个视觉决策先问"长时间阅读友好吗？"
2. **克制**（restraint）—— 默认不用装饰色/阴影/图标；有明确理由才加
3. **一致**（consistency）—— 同类操作长得一样，让用户建立肌肉记忆

v2 起视觉语言统一为 **Ex Libris**（藏书票）隐喻：界面是一座古典图书馆——羊皮纸页面、墨绿墨水、鼠尾草抽屉、描金线。装饰服务于"藏书"气质，但仍受第 2 条"克制"约束。

## 2. Tokens

### 2.1 颜色系统

定义在 `src-ui/src/App.css` 的 CSS 变量。两个主题通过 `.theme-*` class 切换：`.theme-warm` = **Ex Libris Light**（默认；类名沿用旧 ThemeToggle 兼容），`.theme-night` = **Ex Libris Dark**。旧 `mint` 主题已在 Ex Libris 重构中移除。TS 层访问通过 `shared/tokens.ts`。

**双变量约定**：每个颜色暴露两次——`--color-X`（hex/rgba，给直接 CSS 与 `tokens.ts`）+ `--color-X-rgb`（空格分隔 RGB 三元组，给 tailwind 的 `rgb(var(...) / <alpha-value>)` 合成透明度）。**改一个必须同步另一个**（详见 App.css 顶部注释）。

| Token | Light（默认） | Dark | 语义 |
|-------|--------------|------|------|
| `--color-bg` / `--color-surface` | `#F3EFE2`（bg=surface，砍分层） | `#0E1110` / `#12161A` | 羊皮纸页面；Dark 下 surface 微提亮浮卡片 |
| `--color-text` | `#1A2E20` | `#E5DCC4` | 墨绿墨水 / 暖 cream |
| `--color-ink-muted` | `#4A5A4F` | `#95988F` | v13 实色次级文字（比 `text-text/60` 更锐） |
| `--color-ink-faint` | `#8B9A8F` | `#545652` | caption / 索书号次级 |
| `--color-accent` | `#576148` | `#4D5741` | olive —— 动作色 / 选中态 |
| `--color-drawer` | `#47594E` | `#3F5048` | sage —— drawer banner / modal header / 权威表面 |
| `--color-gold` | `#C99A38` | `#DDB565` | 古董金 —— parchment 上的金字 / 描边 |
| `--color-gold-bright` | `#F0CC60` | `#DDB565` | 抛光金箔 —— drawer 上的金线（对比 4-5:1） |
| `--color-inv-text` | `#FBF5E1` | `#E5DCC4` | cream —— 深色表面上的"白" |
| `--color-rule` / `--color-rule-soft` | `rgba(26,46,32,.22 / .08)` | `rgba(229,220,196,.14 / .05)` | hairline 分隔（已含 alpha，tailwind `/N` 修饰无效） |

Status colors（`--color-success/warning/error/info`）按主题独立调校；error 为 **oxblood** `#8B2D1F`（warm 调，Dark 下 `#C26975`）。另有 `--shadow-drawer`（drawer 浮离羊皮纸的双层投影）与 `--gold-top-thick` / `--gold-bottom-thick`（金线厚度）。

### 2.2 文字透明度（4 档固定）

| Class | 用途 |
|-------|------|
| `text-text` / `text-text/90` | 主正文 / 强调 |
| `text-text/70` | 次要信息、body secondary |
| `text-text/50` | 弱化、提示、placeholder |
| `text-text/30` | 近禁用、极弱提示 |

**禁用其他档位**（/40、/45、/55、/65、/75、/85）。Phase 9 已批量规范化。

v13 起新增实色 `text-ink-muted` / `text-ink-faint`：需要更锐利的次级文字（索书号、caption）优先用实色 token；alpha 档继续用于普通弱化。

### 2.3 Border opacity（3 档）

| Class | 用途 |
|-------|------|
| `border-black/5` | 极弱分隔（subtle） |
| `border-black/10` | 标准 hairline |
| `border-black/20` | 强分隔 / input border |

Dark mode 对应 `border-white/5` / `/10` / `/20`。

### 2.4 阴影

**默认不用**。例外：
- Modal overlay：`shadow-strong`（遮罩感必要）
- Toast：`shadow-medium`（浮层）

基础 primitive（Button / Input / Card / InlineBanner）一律无阴影，靠 hairline border 分层。

### 2.5 圆角（5 档，见 `src-ui/src/App.css` 的 `@theme inline` 块）

| Class | px | 用途 |
|-------|-----|------|
| `rounded-xs` | 2 | 极小元素（v2 新增档） |
| `rounded-sm` | 4 | 小标签 |
| `rounded-md` | 8 | 按钮（默认）|
| `rounded-lg` | 12 | 卡片 |
| `rounded-xl` | 16 | Modal / 大卡片 |
| `rounded-full` | ∞ | Pill / 圆形头像 / 图标按钮 |

**禁用 `rounded-2xl`** —— Tailwind 默认值（16px）和自定义 `xl` 等价，会让 DS 提取工具误判。Phase 9 已清理。

### 2.6 字体

四个 stack，全部走 CSS 变量（运行时可切换而无需重渲染，见 `tailwind.config.ts` fontFamily 注释）：

```
font-sans    → var(--font-ui)       Inter + system-ui + CJK fallback
font-serif   → var(--font-reading)  Source Serif 4 + LXGW WenKai Screen
font-display → var(--font-display)  EB Garamond（italic 用于 brand/hero/章节标题）
font-mono    → var(--font-mono)     JetBrains Mono + LXGW（CJK 混排标签干净）
```

- **章节正文** 用 `font-serif`（阅读质感）；**UI 控件** 用 `font-sans`（默认）；**索书号 / 时间戳** 用 `font-mono`；**brand seal / hero / 章节标题** 用 `font-display`
- Source Serif 4 = 单文件 variable font（wght 200-900，`/fonts/source-serif-4.woff2`，bundled）
- LXGW WenKai Screen = 244 个 unicode-range 分包按需加载（`/fonts/lxgw-wenkai-screen/result.css`）
- EB Garamond 当前从 Google Fonts CDN 加载，TODO：按 Source Serif 4 同款方式 bundle 进 `public/fonts/`
- display 的 CJK 回落到 LXGW WenKai Screen，避免 Windows 在 display 场景落到 SimSun

### 2.7 字号（标准 Tailwind）

只用标准档：`text-xs (12) / text-sm (14) / text-base (16) / text-lg (18) / text-xl (20) / text-2xl (24) / text-3xl (30)`。

**禁用任意值** `text-[10px]` / `text-[11px]` / `text-[13px]` 等。Phase 9 已清理。

### 2.8 字重

- `font-medium` (500) — 标准强调 / 按钮 / 标签
- `font-bold` (700) — 标题
- `font-semibold` (600) — **避免新增使用**（残留 20 处待后续收敛）

### 2.9 布局常量

- **阅读列宽度**：`max-w-[720px]`（见 `tokens.layout.readingMaxWidth`）
  - 桌面：720px cap，文字净宽 ~656px（CJK ~73 字/行，舒适区）
  - 移动：w-full（cap 自动失效）

### 2.10 响应式断点

Tailwind 默认 + 一个自定义：
- **`md:` 768px** = 移动/桌面分界
- 写法：mobile-first（默认移动），用 `md:*` 添加桌面样式

### 2.11 安全区

移动端 notch 适配（定义在 `App.css`）：
```css
--safe-area-top: env(safe-area-inset-top, 0px);
--safe-area-bottom: env(safe-area-inset-bottom, 0px);
```

配合 `.safe-area-top` / `.safe-area-bottom` utility class 使用。

## 3. Primitives

所有组件在 `src-ui/src/ui/shared/`。

### 3.1 Button

```tsx
<Button
  tone="accent|neutral|destructive"   // default 'accent'
  fill="solid|outline|plain"          // default 'solid'
  size="sm|md|lg"                     // default 'md'
>
  ...
</Button>
```

**9 个 tone × fill 组合**：

| tone \ fill | `solid` | `outline` | `plain` |
|-------------|---------|-----------|---------|
| `accent` | 主要动作（旧 `primary`） | accent 描边，次级强调 | accent 文字按钮 |
| `neutral` | 中性实心（罕用） | 次级动作（旧 `secondary`） | ghost / cancel / nav（旧 `ghost`） |
| `destructive` | 删除 / 危险（旧 `danger`） | 软删除 / 警示描边 | 弱删除（丢弃草稿） |

**尺寸**：
- `sm`：h-11(mobile) / h-8(desktop)，小组件内
- `md`：h-11 / h-10，默认
- `lg`：h-12，首屏 CTA

触摸目标在移动端全部 ≥ 44px（mobile: h-11 即 44px）。

### 3.2 Tag

```tsx
<Tag tone="default|success|warning|error|info|resolved|deprecated|unresolved|active">
```

混合语义（success/warning/...）与业务状态（FactStatus 映射）。后者（resolved/deprecated/unresolved/active）是 domain-specific，后续可能拆到业务层。

### 3.3 Toast

```tsx
<Toast tone="success|error|info|warning" message="..." onClose?={...} />
```

一般不直接用，通过 `useFeedback().showToast(message, variant)` 触发。

### 3.4 InlineBanner

```tsx
<InlineBanner
  tone="info|warning"       // default 'info'
  layout="card|bar"         // default 'card'
  message={...}
  actions={<>...</>}
  compact?={false}
/>
```

- `layout="card"` = 圆角卡片，正文内嵌提示
- `layout="bar"` = 全宽横条，`border-b` 贴顶部（dirty 章节警告用）
- `compact` 把 text-sm 压到 text-xs（bar 样式常用）

### 3.5 Input / Textarea

```tsx
<Input label="..." error="..." tone="neutral|error" type="..." />
<Textarea label="..." error="..." tone="neutral|error" />
```

- `error` 存在时自动切 `tone='error'`（红色边框 + 下方错误文案）
- 共享 `FieldShell` + `baseFieldStyles` + `toneStyles`

### 3.6 Card

```tsx
<Card className="...">content</Card>
```

最小化 primitive：默认 `rounded-lg p-4 border bg-surface`。实际用法几乎都覆盖（不同页面需要不同 radius/padding），callers 通过 className 调整。**不要** 加 variant —— 需求过于发散。

### 3.7 Modal

```tsx
<Modal isOpen={...} onClose={...} title="...">
  {children}
</Modal>
```

自动响应式：
- 桌面：居中 dialog，`max-w-lg`，带 close (X) 按钮
- 移动：bottom sheet（通过 `MobileSheet` 组件）

title 可省略（children 自决定）。

### 3.8 ConfirmDialog

```tsx
<ConfirmDialog
  isOpen={...}
  onClose={...}
  onConfirm={...}
  title="..."
  message={...}
  confirmLabel?="..."        // default t('common.actions.confirm')
  cancelLabel?="..."         // default t('common.actions.cancel')
  destructive?={false}       // true → destructive tone 的 confirm 按钮
  loading?={false}           // true → confirm 按钮显示 spinner，close 被抑制
/>
```

**用于纯"确认 + 取消"对话框**。如果需要自定义表单体（如章节定稿需要输入标题），直接用 `<Modal>`。

### 3.9 Spinner / LoadingState

```tsx
<Spinner size="sm|md|lg" className="text-accent?" />
<LoadingState message="loading..." compact?={false} />
```

- `Spinner` 行内图标，14/18/24 px
- `LoadingState` 居中容器 + 可选文案（role="status"）
- 替代散写的 `<Loader2 className="animate-spin" />`

### 3.10 其他共享组件（不赘述）

`EmptyState` / `Sidebar` / `Toggle` / `ProgressBar` / `Tooltip` / `ThemeToggle` / `ContextMenu` / `Toast` / `SettingsMarkdown` / `ChapterMarkdown` —— 均有独立使用场景，API 相对稳定。

## 4. Hooks

### 4.1 useActiveRequestGuard

```tsx
const guard = useActiveRequestGuard(auPath);

// 典型 load 流程
const loadData = async () => {
  const token = guard.start();
  setLoading(true);
  try {
    const data = await fetch(...);
    if (guard.isStale(token)) return;
    setData(data);
  } finally {
    if (!guard.isStale(token)) setLoading(false);
  }
};

// 轻量 key-only 检查（不 bump id）
const handleSave = async () => {
  const snapshotKey = auPath;
  await save(...);
  if (guard.isKeyStale(snapshotKey)) return;
  // ...
};
```

保护异步结果不被导航切换污染。5 大文件（WriterLayout / FactsLayout / AuLoreLayout / AuSettingsLayout / AuWorkspaceLayout）统一使用。

### 4.2 useKV

```tsx
const [value, setValue] = useKV(key, defaultValue);
```

跨平台 KV 存储（桌面 Tauri file / 移动 Capacitor / Web IndexedDB）。避免直接调 localStorage（iOS 隐私模式下不可用）。

### 4.3 useFeedback

```tsx
const { showSuccess, showError, showToast } = useFeedback();
```

全局 toast。需要 `<FeedbackProvider>` 在组件树祖先（Library / FandomLoreLayout / AuWorkspaceLayout / MobileFandomView 都自带）。

### 4.4 useTranslation

i18n，基于 react-i18next。`zh.json` / `en.json` 同步，992 keys 双向一致（由 `npm run i18n:check` 检查）。

### 4.5 useMediaQuery

```tsx
const isMobile = useMediaQuery('(max-width: 768px)');
```

响应式分支判断。优于直接用 Tailwind `md:` class 的场景：**JS 条件渲染** 不同组件树（比如 `<MobileLayout>` vs `<DesktopLayout>`），而非同组件的不同样式。

## 5. 模式

### 5.1 响应式模式

- **mobile-first 写法**：基础 class 为移动端，用 `md:*` 添加桌面样式
- **阅读列**：`w-full max-w-[720px]` —— 移动 full，桌面 cap
- **触摸目标**：移动端所有交互元素 ≥ 44px（h-11 或 min-h-[44px]）
- **响应式容器**：banner/action bar 用 `flex flex-col md:flex-row` 移动端堆叠、桌面端并排

### 5.2 无障碍

- Button / Input 默认 `focus-visible:ring-2 focus-visible:ring-accent`
- Modal close button 有 `aria-label`
- LoadingState 有 `role="status" aria-live="polite"`
- 所有交互元素可键盘到达

### 5.3 状态色

- ✅ success（绿）：操作完成
- ⚠ warning（琥珀）：需要注意但非错误（dirty 章节 / 未配置 API）
- ✗ error（红）：操作失败 / 删除
- ℹ info（蓝）：中性提示（历史章节 / 模式切换 tooltip）

不要用 accent 表状态 —— accent 是品牌色，用于主动作，不用于语义状态。

## 6. 品牌 —— Ex Libris

- **名字**：Ex Libris（拉丁语"藏书票 / 出自某人的藏书"），整套视觉隐喻 = 古典图书馆。v1 期待的"有故事的品牌色"即此。
- **出身**：项目内定制。色板（sage drawer + olive accent）由用户的画师朋友给定，探索稿见 `docs/internal/design-explore/library-mobile-exlibris-v13.html`（token 注释里的 "v13" 即指该稿的迭代号）。git 追溯从 `07f88ca feat(theme): replace warm/night themes with Ex Libris palette` 起，共 14 个相关提交。
- **主色**：olive `#576148`（动作）+ sage `#47594E`（权威表面）；**金色只做点缀**（金线 / 描边 / 索书号高亮），不当动作色。
- **error 用 oxblood** `#8B2D1F` —— 比标准红更合 parchment 暖调。
- **字体**：EB Garamond（display）+ Source Serif 4（阅读）+ Inter（UI）+ JetBrains Mono（元数据）。
- **Logo**：仍为占位 `BookOpen` lucide icon，FicForge wordmark 待做。
- **调性**：克制、温暖、长时间阅读友好 —— 藏书馆气质是皮，这三条仍是骨。

## 7. 贡献规则

### 7.1 何时添加新 primitive

- 类似模式 **散落 > 3 处** 且有清晰语义边界
- API 预计 **一个月内稳定**（不是随手抽）
- 抽出后能 **显著减少重复代码**（不是纯"抽象癖"）

反例：Card 当前不加 variant —— 调用点需求过于发散，加 prop 反而限制。

### 7.2 何时扩展现有 primitive

- 加新 tone：更新 `Button.tsx` 的 `toneFillStyles` map + 本文档表格
- 加新 variant：先问"真的不能用现有组合 + className 覆盖吗？"

### 7.3 禁止

- 硬编码 hex 色值在 TS/TSX —— 要么 CSS 变量，要么 `tokens.ts`
- Tailwind 任意值 class（`text-[13px]` / `border-black/15` 等）—— 要用标准档位
- 跨组件复制粘贴相似样式 —— 抽 primitive 或 module-level 常量（见 Button 的 `toneFillStyles`、Input 的 `baseFieldStyles`）
- 用 `variant` 作为 prop 名 —— 已统一 `tone`
- 用 `Loader2` 直接写 —— 用 `Spinner` / `LoadingState`

### 7.4 改动检查清单

改 primitive API 前：
- [ ] 影响的调用点数量
- [ ] 移动端 + 桌面端两侧都测过
- [ ] warm + night 主题都看过
- [ ] `noUnusedLocals` TS 检查
- [ ] vitest ui (59) + engine (550) 都过
- [ ] preview 核心流（Library → AU workspace → writer）跑通

## 8. 变更历史

- **v2** (2026-07-10)：文档对齐 Ex Libris 现状（代码重构在先，本次为文档补账）。warm/mint/night 三主题 → Ex Libris Light/Dark 双主题；新增 drawer / gold / gold-bright / inv-text / rule 系 token 与双变量约定；字体升级为四 stack（EB Garamond display）；记录外部复用（personal-website）。
- **v1** (2026-04-18)：初版。Phase 6-10c 完成后产出。
  - 见 `docs/internal/devlog/2026-04-18-ds-refactor.md`

## 9. 后续路线图

短期：
- 观察 Claude Design 对代码库的 DS 提取效果
- 根据提取反馈决定是否再收敛

中期（品牌层）：
- ~~换 Primary 色~~（✅ v2 由 Ex Libris 完成）；logo / wordmark 与插画仍待做
- 阅读区"纸页质感"（CSS gradient 模拟纸纹）
- 生成时墨水晕开动画（首次用 `tokens.ts`）
- EB Garamond 本地 bundle（摆脱 Google Fonts CDN）

长期：
- 抽成独立 `@ficforge/ui` NPM 包 —— 第 2 个消费者（personal-website）已出现但走"同名变量拷贝"轻同步，抽包 gate 顺延为第 3 个消费者
- 完整 Storybook / 文档网站
