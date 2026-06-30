// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 写作模式类型 + Agent 迭代上限。
 *
 * 历史：本模块原是简版 fork 的 feature-flag 中枢（SimpleFeatures / getSimpleFeatures，
 * 由 AppConfig.writing_mode 推导 4 个 flag）。「对话式×记忆栈融合」收敛为单一主力版后，
 * flag 体系已在 P2 物理删除（gate 在 P1/P2 逐处清掉）。这里仅保留：
 *  - writing_mode 的类型 + 运行时校验 —— settings.yaml 旧文件可能仍带 writing_mode 字段，
 *    需容忍读取（见 file_settings.ts），P3 再评估是否随字段一并退役 WritingMode 类型；
 *  - SIMPLE_AGENT_MAX_ITER —— 对话 agent loop 的迭代上限，与写作模式无关。
 */

/**
 * 写作模式的合法取值集合 —— WritingMode 类型 + isWritingMode 校验的单一真相源。
 */
export const WRITING_MODES = ["full", "simple"] as const;
export type WritingMode = typeof WRITING_MODES[number];

/** 运行时类型守卫：校验来自 settings.yaml / 用户输入的未知字符串是否合法 WritingMode。 */
export function isWritingMode(value: unknown): value is WritingMode {
  return typeof value === "string" && (WRITING_MODES as readonly string[]).includes(value);
}

/**
 * Agent loop 单次 dispatch 最多迭代轮数。read-only tool 自动 fetch + 注 history
 * 后 continue 一轮。超过此值仍未到 terminal（chat_reply / chapter text / mutating
 * tool confirm pending）→ emit AGENT_MAX_ITERATIONS error 让用户拆分请求。
 *
 * 5 是 plan §六 风险缓解协议商定值（balance：足够覆盖"先读 1-2 个文件再决定"的多步
 * 场景；不足以让 LLM 死循环 show 不同文件浪费 token）。修改请同步 plan §六 + tests。
 */
export const SIMPLE_AGENT_MAX_ITER = 5;
