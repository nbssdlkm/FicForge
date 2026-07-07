# LLM 供应商模型数据调研（2026-07-07）

> 用途：① 刷新 `src-engine/domain/model_context_map.ts`；② 「供应商主导的预选模型选择器」设计输入。
> 口径：ctx / max output 优先官方文档；⚠️ = 未官方确证。¥=人民币 $=美元，均按量付费标价。

## 0. 现有 MODEL_CONTEXT_MAP 过时诊断

- `deepseek-chat` / `deepseek-reasoner`（65,536）：**2026-07-24 15:59 UTC 起官方废弃、调用报错**（映射至 deepseek-v4-flash）；实际 V4 已 1M ctx / 384K out
- `claude-sonnet-4-6`（200,000）：实为 1M ctx / 128K out
- `qwen-max`（32,768）：现旗舰 `qwen3.7-max` = 1M；前缀 fuzzy 命不中
- `gpt-4o` / `gpt-4-turbo`、`gemini-1.5-pro` / `2.0-flash`：均遗留/退役；现主力 1M
- `MODEL_MAX_OUTPUT` 全表严重偏低（deepseek 8,192 → 官方 384K；claude 8,192 → 64–128K）
- fuzzy 匹配缺陷：SiliconFlow/OpenRouter 的 `org/Model` 形态 id（`deepseek-ai/DeepSeek-V4-Pro`、`moonshotai/Kimi-K2.6`、`zai-org/GLM-4.7`）`startsWith` 全落 DEFAULT(32k) → 1M 模型浪费 97% 预算。**匹配前应 strip `org/` 前缀 + 小写化**

## 1. 各供应商当前主力（2026-07）

| 供应商 | base_url | 主力模型 | ctx | max out | 价格 | 备注 |
|---|---|---|---|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-flash` | 1M | 384K | $0.14/$0.28 | 旧 id 7-24 报错；文风有「DeepSeek 味」 |
| | | `deepseek-v4-pro` | 1M | 384K | $0.435/$0.87 | |
| Qwen/百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3.7-max` | 1M | ⚠️ | ¥2.5/¥7.5⚠️ | |
| | | `qwen3.7-plus` | 1M | ⚠️ | ¥0.4/¥1.6⚠️ | 性价比 |
| | | `qwen-long` | 10M | ⚠️ | 低 | 超长文档 |
| Kimi | `https://api.moonshot.cn/v1`(国内¥) | `kimi-k2.7-code` | 262,144 | ⚠️ | $0.95/$4.00(国际) | 中文创作口碑好 |
| | | `kimi-k2.6` | 262,144 | ⚠️ | $0.95/$4.00 | |
| GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.2` | 1M | 128K | ¥8/¥28⚠️ | |
| | | `glm-4.7` | 200K | 128K | ¥5⚠️(OR $0.4/$1.75) | 官方点名 creative writing/roleplay 强 |
| 豆包/方舟 | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-2-0-pro-260215` | 256K | 128K⚠️ | ¥3.2/¥16⚠️ | 分段计费（输入越长越贵） |
| | | `doubao-seed-2-0-lite-260215` | 256K | ⚠️ | ¥0.6/¥3.6⚠️ | |
| MiniMax | `https://api.minimaxi.com/v1`(国内) | `MiniMax-M3` | 1M | ⚠️ | ⚠️ | |
| | | `MiniMax-M2.7` | 204,800 | ~196K⚠️ | ¥2.1/¥8.4 | |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V4-Pro` 等 | 同基座 | 同基座 | 托管溢价 | **id 带组织前缀**；`BAAI/bge-m3` embedding 在售（免费状态待真机核） |
| OpenAI | `https://api.openai.com/v1` | `gpt-5.5` / `gpt-5.4` / `gpt-5.4-mini` | 1M/1M/400K | 128K | $5/$30、$2.5/$15、$0.75/$4.5 | 大陆不可直连 |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-3.1-pro-preview` / `gemini-3.5-flash` | 1M | 64K | flash ~$0.5/$3⚠️ | 大陆不可直连；ST 圈中文 RP 常用 |
| Claude | `https://api.anthropic.com/v1/`(兼容层，官方注明非生产推荐) | `claude-opus-4-8` / `claude-sonnet-5` / `claude-sonnet-4-6` / `claude-haiku-4-5` | 1M/1M/1M/200K | 128K/128K/128K/64K | $5/$25、$3/$15(8-31 前 $2/$10)、$3/$15、$1/$5 | 中文小说圈文笔口碑第一；大陆多经 OpenRouter |
| OpenRouter | `https://openrouter.ai/api/v1` | 聚合（`anthropic/...`、`z-ai/...`） | 随模型 | 随模型 | 原价+5% | `/models` 端点**返回 ctx+定价富元数据**（唯一） |
| Ollama | `http://localhost:11434/v1` | 本地 | 标称≠运行时 | — | 免费 | 默认 num_ctx 4096！UI 应强提示手填 ctx |

## 2. 设计输入（预选模型选择器）

1. **静态表过时速度**：国内厂商 6–8 周一次大版本；静态表 3 个月显著过时、6 个月约半数失效。失效两种形态：温和（新模型缺席）与致命（旧 id 下线报错，如 deepseek-chat 7/24）。
2. **业界方案**（无一家纯静态）：Cherry Studio = 内置 provider 预设 + `/v1/models` 拉取 + 手填三层；LobeChat / SillyTavern / ChatBox 同构。
3. **`/v1/models` 局限**：各家都实现，但除 OpenRouter 外**不返回 ctx/max output** → 动态拉取解决「列表过时」，ctx 仍需内置表+fuzzy+手填三层兜底（现架构方向正确，数据与匹配规则需更新）。
4. **非技术用户体验排序**：预置推荐下拉（每厂 2-3 个带场景标注）> 拉取列表（几十个 id 噪音）> 纯手填（拼错=404）。
5. **推荐结构**：内置 `PROVIDER_MANIFEST`（id、base_url、推荐模型数组含 ctx/max_output/标签）单一真相源 → UI 下拉 → 「从 API 获取更多」兜底 → 手填保留。可选：清单做成远程 JSON（jsDelivr 缓解大陆可达性）+ 本地缓存回退，维护成本从「发版」降到「改文件」。
6. DEFAULT_CONTEXT_WINDOW 维持保守（32–64K）——兜底命中的多是小众/本地模型。

## 3. 来源

官方确证：DeepSeek api-docs（含废弃公告）、OpenAI developers docs、Anthropic platform docs、Gemini ai.google.dev（OpenAI 兼容页）、GLM docs.bigmodel.cn（ctx/max out）、Kimi platform 国际价、MiniMax platform docs、Ollama docs（context-length）、阿里云百炼 help（ctx）、SiliconFlow docs。
⚠️ 未确证（写码前控制台人工核对）：Qwen/GLM/豆包全线价格与豆包 max output、Kimi 国内 ¥ 价、SiliconFlow 单价与 bge-m3 免费状态。社区口碑来源：maliangwriter / SillyTavern 指南 / glouth 横评（性质：社区）。
