# Kelivo 模型选择器拆解笔记（2026-07-07，实施参照）

> 来源：直读源码。Kelivo https://github.com/Chevey339/kelivo（Flutter，UI 源自 RikkaHub）；
> RikkaHub https://github.com/rikkahub/rikkahub；Cherry Studio https://github.com/CherryHQ/cherry-studio。
> 配套决策：`2026-07-07-model-picker-decision.md`（方案 B 已拍板，自定义供应商/模型硬性保留）。

## 一、Kelivo 结构速写

**供应商管理**：内置 13 家预设（含默认 baseUrl 正则匹配）；ProviderConfig = id/enabled/name/apiKey/baseUrl/providerType/models[]/modelOverrides{}；列表可拖排序（顺序=选择器分区顺序，单一真相源）、启用开关、分组折叠、搜索、批量删。添加自定义供应商 = bottom sheet 三协议 tab（OpenAI/Google/Claude）→ 填名称/Key/BaseUrl/Path → 新供应商插队列表最前并直进详情页。

**模型管理三来源**：①内置预填（仅 2 家有）②主路径 = 拉 `GET {base}/models` → 结果按系列正则自动分组（GPT/Claude/DeepSeek/Qwen/GLM…，embedding 单独归组）→ 搜索过滤 + 组折叠 + **过滤内全选** → 勾选写入 ③手动添加（与编辑同 sheet）。
**模型元数据**（ModelInfo）：id/displayName/type(chat|embedding)/modalities/abilities(tool|reasoning)；`ModelRegistry.infer()` 大正则按 id 自动推断，用户可全量编辑（modelOverrides，含自定义 header/body、apiModelId 别名）。**没有 contextWindow / maxOutput / 价格**（Kelivo 靠消息条数截断，不做 token 预算——FicForge 不能照抄的根本差异）。
**运维**：收藏 pin（providerKey::modelId，无 recents）、模型拖排序、左滑删/批量删、**批量连通性检测（真实 hello 请求）+ 一键删失败模型**。

**选择器本体**（对话界面）：输入栏 28px 品牌图标按钮 → DraggableScrollableSheet：顶部跨供应商搜索 → 收藏区置顶 → 按供应商分区 + sticky 头（带余额 badge）→ 底部横向供应商 chip 栏（点击跳区、长按进详情）→ 条目 = 品牌图标 + 能力标签胶囊 + 收藏心形，长按=编辑元数据；打开自动定位当前模型。当前模型解析：助手绑定 > 全局（两层）。

**细节巧思**：品牌图标 ~50 条有序正则（model id 优先于 provider 名，含中文别名）→ 本地 SVG；连接测试 = 真实最小对话非 ping；专用模型槽位页（对话/标题/摘要/翻译/OCR/建议 6 槽位各自可指定 + 回退链）；新加供应商插最前。

## 二、Cherry Studio 对照（目录路线）

内置 66 家供应商 + 813 条模型目录（666 条带 contextWindow、508 条带 pricing）。运行时三层合并优先级（源码注释明示）：**user_model > provider-models.json > models.json 目录**。主键 `providerId::modelId`。细粒度 capabilities 枚举做 UI 筛选。代价 = 目录靠社区 PR 养。
RikkaHub：与 Kelivo 同构 + 内置 18 家 + 「推荐供应商」转化位 + Cherry 配置导入器（Cherry 格式已成社区事实标准）。

**一句话**：Kelivo = 轻元数据+正则推断+全靠拉取，零目录成本但无 token 预算能力；Cherry = 重目录三层覆盖，有 contextWindow/价格但要养目录。

## 三、FicForge 实施决定（结合两家）

1. **交互骨架照搬 Kelivo**：供应商列表（拖排序+启用开关）→ 详情页（配置/模型两 tab）→ 三来源；拉取 sheet 的「搜索+分组折叠+过滤内全选」直接抄。
2. **自定义供应商表单砍到单协议**：FicForge 全 OpenAI 兼容 → 只留 名称/BaseUrl/Key（高级折叠：chatPath）。
3. **元数据学 Cherry**：ModelInfo 必带 `contextWindow` + `maxOutputTokens`（喂 computeInputBudget）；能力只留 tool（M9 需要）+ embedding 类型二分；价格不做。
4. **三层合并**：内置推荐清单（几十条主力模型带 ctx）> 拉取（无 ctx 用正则推断默认 + **显式提示「按 XXk 估算」，不许静默 fallback**）> 用户手改（编辑 sheet 里 ctx 必须可编辑）。
5. **两类槽位**：续写主力 LLM / embedding，套 Kelivo 槽位页模式；embedding 槽只显示 embedding 类型（isLikelyEmbeddingId 正则可抄）。
6. **三层生效**：全局默认 / AU 覆盖 / 会话临时（Kelivo 的助手>全局是两层先例）；选择器顶部标当前生效层级 badge。
7. **必抄**：品牌图标正则、连接测试=真实 hello（表单尾部）、收藏 pin、`providerKey::modelId` 复合主键。
8. **不抄**：QR 分享（含明文 key）、多 Key 轮询、余额查询、per-model header/body 覆盖。

## 四、关键源码路径备查

Kelivo：`lib/core/providers/settings_provider.dart`（内置清单/默认 baseUrl）、`lib/core/models/model_types.dart`（ModelInfo/ModelRegistry.infer）、`lib/features/model/widgets/model_select_sheet.dart`（选择器 2363 行）、`model_detail_sheet.dart`（元数据编辑）、`lib/features/provider/widgets/add_provider_sheet.dart`、`lib/features/model/pages/default_model_page.dart`（槽位）、`lib/utils/brand_assets.dart`（品牌正则）。
Cherry：`src/shared/data/types/model.ts`（三层合并注释）、`packages/provider-registry/data/`。
