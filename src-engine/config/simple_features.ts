// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite（粮坊·简）feature flags.
 *
 * 这是简版 fork（D:\fanfic-system-simple）的核心开关。每一处 flag 在主 app 完整模式
 * 仍走原有路径；简版默认走简化分支。flag 的值在运行时由 AppConfig.writing_mode
 * （full | simple）经 getSimpleFeatures 纯函数推导：full 全 false（与收敛前主 app 行为
 * 逐字节一致），simple 全 true。引用方禁止自己读 writing_mode 再各自映射 —— 唯一的
 * mode → flags 映射逻辑就住在本模块的 getSimpleFeatures 里。
 *
 * Why a single source: 任何引用方都从此模块 import，禁止散落硬编码 `true`/`false`。
 * 加新 flag 时同步更新 docs/internal/plans/simple-app-mvp-plan.md §四.7。
 */

export interface SimpleFeatures {
  /** assemble_context 走"全塞"分支：不做 P0-P5 预算切分，直接把全部 worldbuilding + characters + chapters 拼成 user message。 */
  readonly simpleAssembler: boolean;
  /** 原 gate 写文生成期 RAG 检索（generation.ts）。**融合后(plan §1.0)已删该 gate、写文 RAG 恒开,
   *  本字段已无生产消费者**(仅 simple_features.test.ts 快照断言仍引用)—— 保留仅因 simple_features
   *  整体在 P2 与模式系统一并退役删除,届时本字段及其快照断言同删。 */
  readonly disableRAG: boolean;
  /** 跳过 facts 提取流水线（confirm 完不弹"是否提取事实"提示，也不调 extract_facts_from_chapter）。 */
  readonly disableFactsExtraction: boolean;
  /** 跳过章节摘要生成（M8 三层架构里的 Chapter Summary 层；简版 MVP 不做）。 */
  readonly disableChapterSummary: boolean;
}

/**
 * 写作模式的合法取值集合 —— 单一真相源：类型 WritingMode、运行时校验 isWritingMode、
 * 以及（Phase 2）模式 toggle UI 的下拉项全部从这一处数组派生。加新模式只改这一行
 * （再到 getSimpleFeatures 给出对应 flag 画像）。
 */
export const WRITING_MODES = ["full", "simple"] as const;
export type WritingMode = typeof WRITING_MODES[number];

/** 运行时类型守卫：校验来自 settings.yaml / 用户输入的未知字符串是否合法 WritingMode。 */
export function isWritingMode(value: unknown): value is WritingMode {
  return typeof value === "string" && (WRITING_MODES as readonly string[]).includes(value);
}

/** Pure derivation: mode -> the 4 simple flags. Single source of truth for the mapping.
 *  full  => every flag false (MAIN behavior, byte-identical to pre-convergence).
 *  simple => every flag true.
 *  布尔折叠对 2 值枚举既正确又 DRY；未来若加第 3 种模式且 flag 画像非"全同"，
 *  需把此折叠改成显式 per-mode 映射（而非简单加一行数据）。 */
export function getSimpleFeatures(mode: WritingMode): SimpleFeatures {
  const on = mode === "simple";
  return {
    simpleAssembler: on,
    disableRAG: on,
    disableFactsExtraction: on,
    disableChapterSummary: on,
  };
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
