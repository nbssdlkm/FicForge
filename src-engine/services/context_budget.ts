// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 上下文组装 —— 输出/输入预算计算 + 实际生效 LLM 视图（从 context_assembler.ts 机械拆出，
 * P0 高风险模块三拆一，行为逐字节不变）。
 *
 * D-0039 输出上限 computeMaxOutputTokens / 输入预算 computeInputBudget，是写文 assembleContext
 * 与对话 assembleChatContext 共用的单一真相源；另含 EffectiveLLM 最小视图与对话历史预留系数。
 * prompt 块见 context_prompt_blocks.ts；级联与 assemble 主函数见 context_assembler.ts。
 */

import { getModelMaxOutput } from "../domain/model_context_map.js";
import { DEFAULT_CHAPTER_LENGTH } from "../domain/project.js";
import type { Project } from "../domain/project.js";
import { warnAlways } from "../logger/index.js";

// ---------------------------------------------------------------------------
// EffectiveLLM —— 实际生效 LLM 的最小视图（审计 H4）
// ---------------------------------------------------------------------------

/**
 * 「实际生效 LLM」最小视图（审计 H4）。
 *
 * 实际发请求的模型由 resolveLlmConfig(session_llm, project, settings) 三层解析，
 * 可能落在 settings.default_llm（最主流配置：全局默认 + AU 无覆盖）——而 assembler
 * 历史上只看 project.llm，导致该场景按 DEFAULT_CONTEXT_WINDOW=32k / max_output("")=4096
 * 计算，64k+ 模型的大半输入预算被白白扔掉；反向的小窗口 session 模型则可能超窗。
 *
 * 调用方（generation / simple_chat_dispatch / estimate）把 resolve 结果传进来即可 ——
 * ResolvedLLMConfig 结构上就满足本视图（mode/model/context_window）。
 *
 * **为什么是可选参数 + 缺省回退 project.llm**：向后兼容是硬约束。已有调用方 / golden
 * test 只传 project，不传本视图时必须与修改前逐字节一致（窗口、输出上限、预算、messages
 * 全部不变）；接线只在「手里有 resolve 结果」的调用点显式 opt-in。
 */
export interface EffectiveLLM {
  mode?: string;
  model?: string;
  /** 手动指定的 context window；undefined/0 = 按 model 名走 MODEL_CONTEXT_MAP 推断。 */
  context_window?: number;
}

/**
 * D-0039 输出预算单一真相源：maxTokens = min(模型输出上限, contextWindow×40%, 章节长×2, 15k 硬顶)。
 * 超长章节被 CEIL 夹断时打 warn。写文 assembleContext 与对话 assembleChatContext 共用，避免
 * 15_000 字面量与 Math.min 公式两处手工维护漂移（D-0039 曾 rebalance 过一次，retune 时只需改这一处）。
 * @param logTag 日志前缀（"context_assembler" / "assembleChatContext"）
 * @param effective_llm 实际生效 LLM 视图（H4）；缺省回退 project.llm（向后兼容）。
 *        chapter_length 仍来自 project —— 章节长度是作品属性，与用哪个模型无关。
 */
export function computeMaxOutputTokens(
  project: Project,
  contextWindow: number,
  logTag: string,
  effective_llm?: EffectiveLLM,
): number {
  const OUTPUT_RESERVE_CEIL = 15_000;
  const modelName = (effective_llm ? effective_llm.model : project.llm?.model) ?? "";
  const chapterLength = project.chapter_length ?? DEFAULT_CHAPTER_LENGTH;
  const chapterTokenCap = chapterLength ? chapterLength * 2 : Infinity;
  const maxTokens = Math.min(
    getModelMaxOutput(modelName),
    Math.trunc(contextWindow * 0.4),
    chapterTokenCap,
    OUTPUT_RESERVE_CEIL,
  );
  // 警告：超长章节被 CEIL 截断时打 warn，让用户感知
  if (chapterTokenCap !== Infinity && chapterTokenCap > OUTPUT_RESERVE_CEIL) {
    warnAlways(
      logTag,
      `chapter_length=${chapterLength} 对应 ${chapterTokenCap} tokens 超过 OUTPUT_RESERVE_CEIL=${OUTPUT_RESERVE_CEIL}，maxTokens 被夹至 ${maxTokens}，章节可能被 LLM 截断`,
    );
  }
  return maxTokens;
}

// D-0039 input budget 公式的两个余量常量（写文 / 对话两 assembler 共用，单一真相源）。
const OUTPUT_RESERVE_FLOOR = 10_000;
const SAFETY_BUFFER = 500;

/**
 * D-0039 input budget 单一真相源（写文 assembleContext 与对话 assembleChatContext 共用）。
 *
 * 新公式 = contextWindow − 实际输出预留(max(maxTokens, FLOOR)) − systemTokens − SAFETY_BUFFER；
 * 旧 60% 公式（ctx×0.6 − system）作**下限兜底**，保证小模型不退步（D-0039 rebalance 记录）。
 *
 * 不在此钳零：写文路径靠返回值 ≤0 触发裁剪 custom_instructions 的 fail-safe 再重算；对话路径在
 * 外层自己套 Math.max(0, …)。把公式抽到这一处后，retune 只改这里，杜绝两 assembler 手抄漂移。
 */
export function computeInputBudget(contextWindow: number, systemTokens: number, maxOutputTokens: number): number {
  const reservedForOutput = Math.max(maxOutputTokens, OUTPUT_RESERVE_FLOOR);
  return Math.max(
    contextWindow - reservedForOutput - systemTokens - SAFETY_BUFFER,
    Math.trunc(contextWindow * 0.6) - systemTokens,
  );
}

/**
 * 对话路径输入侧预留给「过去多轮历史」的预算系数与硬顶。
 *
 * 语义：assembleChatContext 只组装 system（人设 + 记忆层）+ 最新一轮 user；
 * dispatch 把过去的对话历史夹在两者之间（[system, ...history, latestUser]）。历史
 * 不在此函数内做预算管控（"全塞"哲学：历史全带，超 ctx 由 LLM 报错），但记忆层若
 * 吃满整个 input budget 就没空间留给历史。于是从 budget 里先扣一份 chatHistoryReserve
 * （= budget×RATIO，封顶 CEIL），让记忆层只在 budget − reserve 内竞争。
 *
 * 最新轮硬保：最新一轮 user（latestUserContent）始终完整保留，先计入 used（类比完整
 * 模式 P1 当前指令），永不被预算裁剪；reserve 只压缩"记忆层"，不压缩最新轮。
 *
 * export 供 context_assembler.chat.test.ts 复算 memBudget 断言记忆层确实被压在 budget−reserve
 * 内（而非仅靠 core_guarantee 兜出 budget_remaining>0 —— 那是伪命题，抓不住 reserve 回归）。
 */
export const CHAT_HISTORY_RESERVE_RATIO = 0.3;
export const CHAT_HISTORY_RESERVE_CEIL = 12_000;
