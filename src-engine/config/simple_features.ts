// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 对话 Agent 迭代上限。
 *
 * 历史：本模块原是简版 fork 的 feature-flag 中枢（SimpleFeatures / getSimpleFeatures，
 * 由 AppConfig.writing_mode 推导 4 个 flag），并承载 WritingMode 类型 + isWritingMode 校验。
 * 「对话式×记忆栈融合」收敛为单一主力版后，flag 体系（P2）+ writing_mode 字段（P3）均已
 * 物理退役。本模块现仅保留 SIMPLE_AGENT_MAX_ITER —— 对话 agent loop 的迭代上限，与写作模式无关。
 */

/**
 * Agent loop 单次 dispatch 最多迭代轮数。read-only tool 自动 fetch + 注 history
 * 后 continue 一轮。超过此值仍未到 terminal（chat_reply / chapter text / mutating
 * tool confirm pending）→ emit AGENT_MAX_ITERATIONS error 让用户拆分请求。
 *
 * 5 是 plan §六 风险缓解协议商定值（balance：足够覆盖"先读 1-2 个文件再决定"的多步
 * 场景；不足以让 LLM 死循环 show 不同文件浪费 token）。修改请同步 plan §六 + tests。
 */
export const SIMPLE_AGENT_MAX_ITER = 5;
