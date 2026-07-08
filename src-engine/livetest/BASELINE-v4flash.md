# Livetest 基线记录 — deepseek-v4-flash（火山方舟）

> 真 LLM 探针的肉眼评基线。**换模后不可直接对旧 deepseek-chat 记录比**（历史基线在 deepseek-chat，2026-07-24 官方停用）。
> 跑法：`npx vitest run --config vitest.live.config.ts`（网关/模型走 `~/.deepseek/config.toml` 单一真相源，见 `_deepseek.ts`）。
> 硅基流动 embedding 在本机需 `NODE_USE_ENV_PROXY=1`（Node undici 不认 env 代理；ark 直连不需代理）。

## 2026-07-08 基线（LLM=deepseek-v4-flash-260425 @ ark.cn-beijing.volces.com；Embedding=BAAI/bge-m3）

| 探针 | 结果 | 备注 |
|------|------|------|
| M8-C standard/micro 摘要（情感保真） | ✅ 优 | standard 完整保留情绪基调（「心口一凉」「十年冤屈终得确证」「决意面圣翻案」）；micro 紧凑忠实 |
| M8-A 富化字段（单次调用路径） | ✅ 优 | location/story_time/action_verb/known_to/suspense_type 全部合理填充；无幻觉 |
| M10 retrospective（后见之明） | ✅ | 修复探针 stub（chapterRepo 需 `.get()` 非 `get_content_only`）后通过 |
| Embedding bge-m3（1024 维 + 语义相似度） | ✅ | dim=1024；相关查询 0.71 ≫ 无关 0.34（curl+python 验，vitest 内因本机代理另说） |
| **M9 ReAct 提取（协议 + 跨章因果）** | ⚠️ **间歇 0 事实** | 见下方「已知问题」 |

## 已知问题（v4-flash M9 ReAct）

v4-flash 下 M9 有**两种**间歇失败，别混为一谈：

**模式 A — tool-call JSON 写坏（已修，2026-07-08）**
- **根因**：`propose_facts` 的 `evidence` 字段原要求逐字复制含引号 / 跨行的原文；v4-flash 间歇性把字面换行 / 未转义引号写进 JSON 字符串 → 非法 JSON → parse 双双抛错 → 0 事实。
- **修法**：①Layer A：evidence 改「单行、8-20字、免引号的短摘录」（schema + prompt），从源头压低发生率 + 省 token。②Layer B：`tool_args_repair` 加 `salvageMalformedJson` —— 严格 parse 失败后**只补串内字面控制字符**（换行/制表符），model-agnostic、任何模型任何工具都受益。**刻意不猜未转义引号**（那本质歧义，贪心猜会静默截断写错数据——对抗审 HIGH），引号类一律安全回退 retryHint，绝不静默改数据。判别性单测在 `tool_args_repair.test.ts`「malformed JSON 抢救」。
- **成功时质量优**：不炸的题材，跨章 caused_by 召回 2/2、自动挂线正确、零幻觉、零过度提取（含红鲱鱼题材也挂对）。

**模式 B — 模型不按工具协议走（未修，模型能力问题）**
- **现象**：v4-flash 有时不调 propose_facts、以纯文本收尾 → `status=degraded, facts=0`（无 `tool_input_invalid`、salvage 不触发）。这是 v4-flash 作为 tool-caller 的能力弱点，与 JSON 转义无关，本次未处理。
- **附带成本**：也常不调 `finalize_extraction`，即使已产出事实也把循环跑满 maxIter(8) 才停——白烧 token。
- 广度探针单次 3/4 通过↔1/4 通过 大幅波动，主要来自模式 B 的高方差。

**两种模式生产上都有兜底**：`engine-facts.ts` `degraded && facts==0` 回退单次调用（提取仍成功，只丢该章跨章 caused_by + 自动挂线）。非崩溃。**模式 B 若要根治 = 属"换更强 tool-caller 模型 / 加 tool 强制"的产品/模型取舍**，未排期。
