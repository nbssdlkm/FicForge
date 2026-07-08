// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * M9 ReAct 提取工具集。三个工具（spec PD-1 决议：合并 link_caused_by +
 * propose_thread_assignment 为 annotate_fact）：
 *
 *   - search_existing_facts: 检索已持久化事实（拿真实 fact_id 供跨章 caused_by）
 *   - propose_facts:         结构化提议一批新事实（字段对齐 rawToExtracted 的读取）
 *   - annotate_fact:         search 后为某条提议事实标注 caused_by 真实 fact_id +
 *                            归属 thread_ids（按 fact_index 引用 propose 输出下标）
 *
 * 单一真相源：Zod schema 同时供 (a) tool_args_repair 校验/修复，(b) 经 z.toJSONSchema
 * 派生 LLM 看到的 ToolDefinition.parameters —— 避免 simple_tools_zod + settings_tools
 * 那种「zod 一份、JSON schema 又手写一份」的双维护漂移。
 *
 * 关于 verify_fact（spec §2.2 第 5 个工具）：Phase 1 不实现。防幻觉改走 dispatch 里
 * 的轻量过滤（annotate 时丢掉不存在的 fact_id / thread_id），不进 LLM 循环（见
 * react_extraction_dispatch.ts）。
 */

import { z } from "zod";
import type { ToolDefinition } from "../llm/provider.js";
import {
  FACT_TYPE_VALUES,
  NARRATIVE_WEIGHT_VALUES,
  TIME_KIND_VALUES,
  SUSPENSE_TYPE_VALUES,
} from "../domain/enums.js";

// ---------------------------------------------------------------------------
// 工具名常量 —— dispatch switch / 测试引用，避免字符串散落
// ---------------------------------------------------------------------------

export const REACT_TOOL_SEARCH = "search_existing_facts";
export const REACT_TOOL_PROPOSE = "propose_facts";
export const REACT_TOOL_ANNOTATE = "annotate_fact";
export const REACT_TOOL_FINALIZE = "finalize_extraction";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const searchExistingFactsSchema = z.object({
  query: z.string().min(1).describe("关键词或角色名，用于检索已有事实"),
  characters: z.array(z.string()).optional().describe("按角色名过滤（可选）"),
  // 注意：用 .optional() 而非 .default()，否则 z.toJSONSchema 会把它列进 required，
  // 逼 LLM 每次都传 limit。默认值在 dispatch 执行时兜底（args.limit ?? 10）。
  limit: z.number().int().min(1).max(20).optional().describe("返回条数上限，默认 10"),
});

/**
 * propose_facts 单条事实。字段对齐 rawToExtracted 的读取键：dispatch 把每条原样喂
 * rawToExtracted 做枚举校验 + 角色名归一化（复用单次调用路径的成熟逻辑，DRY）。
 * 所以这里的 enum 只是给 LLM 的提示 + 轻量 gate；非法值最终由 rawToExtracted 兜底。
 */
const proposeFactItemSchema = z.object({
  // min(1) 而非 min(5)：避免单条过短把整批 propose 退回。逐条 min-5 过滤交给 dispatch 的
  // rawToExtracted（与单次调用路径一致，per-fact 容错）。
  content_clean: z.string().min(1).describe("纯叙事描述（第三人称客观，建议 5 字以上），注入续写时使用"),
  content_raw: z.string().optional().describe("带章节编号的原文引用（可选）"),
  // grounding（codex 二审 MAJOR-4）：想给这条事实标 caused_by / thread_ids，必须给一段
  // 本章原文逐字摘录。dispatch 做确定性子串校验，匹配不上则拒绝 annotate（防把因果/剧情线
  // 挂到幻觉事实上）。基础提取（不挂边）不强制 evidence。
  // 只要一小段可定位的短语（不是整段）：短 + 单行 + 无引号，能大幅降低 tool-call JSON 被
  // 未转义引号 / 字面换行写坏的概率（部分模型逐字抄含引号原文时不转义 → JSON.parse 失败 →
  // 整批提取丢空）。grounding 只做子串匹配，一句短语足够定位。
  evidence: z.string().optional().describe("本章原文里一句可定位的短语（8-20字即可，单行、不要包含任何引号），用来把这条事实锚回原文"),
  characters: z.array(z.string()).describe("涉及角色名（可空数组）"),
  fact_type: z.enum(FACT_TYPE_VALUES).optional().describe("事实类型"),
  narrative_weight: z.enum(NARRATIVE_WEIGHT_VALUES).optional().describe("叙事权重"),
  // M8-A 富化字段（全可选；不填不影响）
  location: z.string().optional().describe("场景地点（如「御书房」）"),
  story_time_tag: z.string().optional().describe("人类可读时间标签（如「Y1 冬末」）"),
  story_time_order: z.number().optional().describe("故事内时序排序整数"),
  time_kind: z.enum(TIME_KIND_VALUES).optional().describe("叙事时间种类"),
  action_verb: z.string().optional().describe("核心动作一词（如「决裂」）"),
  known_to: z
    .union([z.literal("all"), z.literal("reader_only"), z.array(z.string())])
    .optional()
    .describe("谁知道这件事：all / reader_only / 知情角色名数组"),
  hidden_from: z.array(z.string()).optional().describe("明确不知情的角色"),
  suspense_type: z.enum(SUSPENSE_TYPE_VALUES).optional().describe("悬念类型"),
  // 因果 / 剧情线（M9 核心）—— 实测真 LLM 不肯走单独的 annotate 步，故支持在 propose 时
  // 内联填：caused_by_fact_ids 用上方「已有事实」列表里的 [fact_id]（需配 evidence 才生效），
  // thread_ids 用「可用剧情线」里的 id。成因不在上方列表时，才另用 search_existing_facts。
  caused_by_fact_ids: z.array(z.string()).optional().describe("此事实的直接成因 fact_id（来自上方已有事实列表的 [id]）"),
  thread_ids: z.array(z.string()).optional().describe("此事实归属的剧情线 id（来自下方可用剧情线列表）"),
});

const proposeFactsSchema = z.object({
  facts: z.array(proposeFactItemSchema).min(1).describe("本轮提议的新事实列表"),
});

const annotateFactSchema = z.object({
  fact_index: z.number().int().min(0).describe("propose_facts 输出数组的下标（从 0 起）"),
  caused_by_fact_ids: z
    .array(z.string())
    .optional()
    .describe("此事实的直接成因 fact_id 列表（来自 search_existing_facts 的结果）"),
  thread_ids: z
    .array(z.string())
    .optional()
    .describe("此事实归属的剧情线 id 列表（来自系统提示给出的可用剧情线）"),
});

/** 显式终止工具（codex 二审 BLOCKER-1）：把「提取完成」做成明确信号，不靠纯文本兜底。 */
const finalizeExtractionSchema = z.object({});

/** repair/validate 用 schema 表（单一真相源；dispatch repairToolArgs 引用）。 */
export const EXTRACTION_TOOL_SCHEMAS: Record<string, z.ZodType> = {
  [REACT_TOOL_SEARCH]: searchExistingFactsSchema,
  [REACT_TOOL_PROPOSE]: proposeFactsSchema,
  [REACT_TOOL_ANNOTATE]: annotateFactSchema,
  [REACT_TOOL_FINALIZE]: finalizeExtractionSchema,
};

/** 提取工具无路径字段（不像 simple 的 file_path 需要 markdown 拆解 pre-pass）。 */
export const EXTRACTION_TOOL_PATH_FIELDS: Record<string, (string | number)[][]> = {};

// ---------------------------------------------------------------------------
// LLM-facing ToolDefinition[]（由同一份 zod 派生，单一真相源）
// ---------------------------------------------------------------------------

const TOOL_DESCRIPTIONS: Record<string, string> = {
  [REACT_TOOL_SEARCH]:
    "检索本作品已持久化的事实，按关键词/角色过滤，返回 { fact_id, content_clean, characters, chapter } 列表。" +
    "用它拿到真实 fact_id，再用 annotate_fact 填 caused_by 建立跨章因果。",
  [REACT_TOOL_PROPOSE]:
    "提议一批从当前章节抽取到的新事实。先调用本工具产出事实，再视需要 search + annotate 补因果/剧情线。",
  [REACT_TOOL_ANNOTATE]:
    "为某条已提议事实（按 fact_index）标注成因 caused_by_fact_ids（需先 search 拿真实 fact_id）" +
    "与归属剧情线 thread_ids。仅在确有因果/归属时调用。注意：目标事实必须在 propose_facts 时带过" +
    "能在本章原文匹配上的 evidence，否则会被拒绝。",
  [REACT_TOOL_FINALIZE]:
    "提取全部完成后调用本工具结束（不要用纯文本结束）。调用前请确认该补的 caused_by / thread_ids 都补完了。",
};

function toToolDefinition(name: string, schema: z.ZodType): ToolDefinition {
  // z.toJSONSchema 产出 draft 2020-12；OpenAI tool parameters 接受标准 JSON Schema 子集。
  // 去掉 $schema 顶层键（OpenAI 不需要，留着无害但更干净）。
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete json.$schema;
  return {
    type: "function",
    function: {
      name,
      description: TOOL_DESCRIPTIONS[name] ?? "",
      parameters: json,
    },
  };
}

export const EXTRACTION_TOOLS: ToolDefinition[] = [
  toToolDefinition(REACT_TOOL_SEARCH, searchExistingFactsSchema),
  toToolDefinition(REACT_TOOL_PROPOSE, proposeFactsSchema),
  toToolDefinition(REACT_TOOL_ANNOTATE, annotateFactSchema),
  toToolDefinition(REACT_TOOL_FINALIZE, finalizeExtractionSchema),
];
