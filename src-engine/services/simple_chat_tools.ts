// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — simple_chat 工具层（自 simple_chat_dispatch.ts 拆出，E4a）
 *
 * 无状态工具判据与参数处理，供编排层（simple_chat_dispatch）与只读工具执行层
 * （simple_chat_read_tools）复用：
 *  - 工具名常量 + read-only / mutating 分类（SIMPLE_MUTATING_TOOLS 从实际下发工具集派生）
 *  - isReadOnlyTool / isMutatingTool / isKnownTool 纯判据
 *  - repairToolArgs：Layer 1 tool-args 校验 + 修复（无 telemetry 副作用，trace 交调用方投影）
 *
 * 本文件不进 services/index.ts barrel —— 原先私有的判据仅供本文件族内部 import；
 * 原公共符号（SIMPLE_TOOL_SHOW_* / SIMPLE_TOOL_CHAT_REPLY / SIMPLE_MUTATING_TOOLS）
 * 由 simple_chat_dispatch 再导出以保持既有路径与 barrel 不变。
 */

import { get_tools_for_mode } from "../domain/settings_tools.js";
import { SIMPLE_TOOL_PATH_FIELDS, SIMPLE_TOOL_SCHEMAS } from "../domain/simple_tools_zod.js";
import { repairAndValidateToolArgs, type RepairTrace } from "./tool_args_repair.js";

export const SIMPLE_TOOL_SHOW_CHAPTER = "show_chapter";
export const SIMPLE_TOOL_SHOW_SETTING = "show_setting";
export const SIMPLE_TOOL_CHAT_REPLY = "chat_reply";

const SIMPLE_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([SIMPLE_TOOL_SHOW_CHAPTER, SIMPLE_TOOL_SHOW_SETTING]);

/**
 * 修改类工具集合（agent loop 走 human-in-the-loop：emit ToolCallCard → break → 用户
 * confirm 后另起 dispatch round）。
 *
 * 从「实际下发给 LLM 的工具集」get_tools_for_mode("simple") 派生，不再手工双列
 * （盲审 2026-07-11 功能维：旧手工列表额外含 create_/modify_core_character_file —— 它们
 * 从不下发给简版 LLM、UI 执行器也无实现，LLM 幻觉调用会渲染成「可确认却执行不了」的
 * 卡片。派生保证：能出确认卡的 ≡ 真正下发且 UI 可执行的修改类工具，两侧永不漂移）。
 */
export const SIMPLE_MUTATING_TOOLS: ReadonlySet<string> = new Set(
  (get_tools_for_mode("simple") as { function: { name: string } }[])
    .map((t) => t.function.name)
    .filter((n) => n !== SIMPLE_TOOL_CHAT_REPLY && !SIMPLE_READ_ONLY_TOOLS.has(n)),
);

export function isMutatingTool(name: string): boolean {
  return SIMPLE_MUTATING_TOOLS.has(name);
}

export function isReadOnlyTool(name: string): boolean {
  return SIMPLE_READ_ONLY_TOOLS.has(name);
}

/**
 * 已知（受声明）的工具集合：read-only + mutating + chat_reply + 有 zod schema 的。
 * LLM 幻觉出未声明的工具名（M15）时 isKnownTool=false —— 此类调用参数一律视为无效，
 * 走 repair 的 retryHint 路径让 LLM 改选合法工具，而不是原样 emit 成"无名待确认卡片"
 * （既无 schema 也无执行器，用户 confirm 也执行不了）。
 */
export function isKnownTool(name: string): boolean {
  return (
    isReadOnlyTool(name) ||
    isMutatingTool(name) ||
    name === SIMPLE_TOOL_CHAT_REPLY ||
    Object.hasOwn(SIMPLE_TOOL_SCHEMAS, name)
  );
}

/**
 * 通过 Layer 1 (tool_args_repair) 校验 + 修复 LLM 给的 tool args。
 *
 * 整合 commit 6beb720 引入的"args=`{}` 触发 retry hint"路径 + Awais (CommandCode)
 * 帖子的 4 类形状修复 + Markdown 链接拆解（路径字段污染）。返：
 *   - args:      修复后参数（success=true 时）或空对象（fail 时走 retry 路径）
 *   - retryHint: fail 时给 LLM 的可读提示（已加"注意："前缀避免 TUI 标红 / 模型把
 *                它当 fatal 中断推理）
 *   - success:   schema 最终校验通过与否
 *   - repairs:   trace 数组，留 telemetry hook（commit 6 接 Layer 5 后逐条 emit
 *                tool_input_repaired:{toolName}:{kind}）
 *
 * 未知 tool name（理论上 LLM 不调无声明的 tool）→ 退化到 JSON.parse 兜底 + 通用
 * retry hint，让 LLM 改选其它 tool。
 */
export function repairToolArgs(
  toolName: string,
  rawArgs: string,
): {
  args: Record<string, unknown>;
  retryHint?: string;
  success: boolean;
  repairs: RepairTrace[];
} {
  const schema = SIMPLE_TOOL_SCHEMAS[toolName];
  const pathFields = SIMPLE_TOOL_PATH_FIELDS[toolName];
  if (!schema) {
    let parsed: Record<string, unknown> = {};
    try {
      const obj = JSON.parse(rawArgs || "{}");
      if (obj && typeof obj === "object" && !Array.isArray(obj)) parsed = obj;
    } catch {
      /* fall through */
    }
    return {
      args: parsed,
      success: false,
      repairs: [],
      retryHint: `注意：工具 ${toolName} 没有声明的 schema，请检查工具名是否正确。`,
    };
  }
  const result = repairAndValidateToolArgs(toolName, rawArgs, schema, { pathFields });
  return {
    args: result.success ? (result.data as Record<string, unknown>) : {},
    success: result.success,
    repairs: result.repairs,
    retryHint: result.retryHint,
  };
}
