# FicForge Design System (v1)

> Reference for visual design tokens, UI primitives, and contribution conventions.
> Applies to `src-ui/` and any future project reusing these primitives.

## 1. 哲学

三条原则贯穿所有决策：

1. **阅读优先**（reading-first）—— FicForge 是写作/阅读应用，每个视觉决策先问"长时间阅读友好吗？"
2. **克制**（restraint）—— 默认不用装饰色/阴影/图标；有明确理由才加
3. **一致**（consistency）—— 同类操作长得一样，让用户建立肌肉记忆

## 2. Tokens

### 2.1 颜色系统

定义在 `src-ui/src/App.css` 的 CSS 变量。3 个主题通过 `.theme-*` class 切换。TS 层访问通过 `shared/tokens.ts`。

| Token | `warm`（默认） | `mint` | `night` |
|-------|---------------|--------|---------|
| `--color-bg` | `#FAF9F7` | `#F0F7F2` | `#262624` |
| `--color-surface` | `#F2F0EB` | `#E6F0E9` | `#2F2D2A` |
| `--color-text` | `#3D3935` | `#2D3A2E` | `#E0DDD8` |
| `--color-accent` | `#C5705D` | `#6BAF7A` | `#C5705D` |

Status colors（`--color-success/warning/error/info`）在每个主题独立调整可读性。

### 2.2 文字透明度（4 档固定）

| Class | 用途 |
|-------|------|
| `text-text` / `text-text/90` | 主正文 / 强调 |
| `text-text/70` | 次要信息、body secondary |
| `text-text/50` | 弱化、提示、placeholder |
| `text-text/30` | 近禁用、极弱提示 |

**禁用其他档位**（/40、/45、/55、/65、/75、/85）。Phase 9 已批量规范化。

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

### 2.5 圆角（5 档，见 `tailwind.config.ts`）

| Class | px | 用途 |
|-------|-----|------|
| `rounded-sm` | 4 | 小标签 |
| `rounded-md` | 8 | 按钮（默认）|
| `rounded-lg` | 12 | 卡片 |
| `rounded-xl` | 16 | Modal / 大卡片 |
| `rounded-full` | ∞ | Pill / 圆形头像 / 图标按钮 |

**禁用 `rounded-2xl`** —— Tailwind 默认值（16px）和自定义 `xl` 等价，会让 DS 提取工具误判。Phase 9 已清理。

### 2.6 字体

```
font-serif: Charter, Georgia, "Noto Serif CJK SC", SimSun, serif
font-sans:  Inter, -apple-system, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif
font-mono:  "JetBrains Mono", "Fira Code", monospace
```

- **章节正文** 用 `font-serif`（阅读质感）
- **UI 其他** 用 `font-sans`（默认）
- **数字 / token / 时间戳** 用 `font-mono`（单宽对齐）

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

## 6. 品牌

- **主色** `#C5705D` (warm) / `#6BAF7A` (mint) —— 目前沿用，未来会替换为有故事的品牌色
- **Night 主题 accent**：当前硬编码 `#C5705D`，忽略用户选的 palette（见 TECH-DEBT，后续修）
- **字体**：Charter 衬线 + Inter 无衬线 + JetBrains Mono —— 读起来温暖、偏书本
- **Logo**：占位的 `BookOpen` lucide icon，未来替换为 FicForge 自定义 wordmark
- **调性**：克制、温暖、长时间阅读友好 —— 一切设计决策回归这个调性

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

- **v1** (2026-04-18)：初版。Phase 6-10c 完成后产出。
  - 见 `docs/internal/devlog/2026-04-18-ds-refactor.md`

## 9. 后续路线图

短期：
- 观察 Claude Design 对代码库的 DS 提取效果
- 根据提取反馈决定是否再收敛

中期（品牌层）：
- 换 Primary 色 + logo + 插画（需设计输入）
- 阅读区"纸页质感"（CSS gradient 模拟纸纹）
- 生成时墨水晕开动画（首次用 `tokens.ts`）

长期：
- 抽成独立 `@ficforge/ui` NPM 包（第 2 个项目需要时）
- 完整 Storybook / 文档网站
