// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge agent harness Layer 5 — 结构化 telemetry。
 *
 * 替代 dispatch / agent_loop 内散落的 console.warn，让多 agent 上线后能观测：
 *   - Tool args repair 触发率（Awais 帖子的 telemetry 副产品 —— 模型一退化用户
 *     还没发现，日志已经能看出来）
 *   - Agent loop 退化路径（max_iter / EMPTY guard / chat_reply 偏离 / 双 emit）
 *   - Provider capability fallback（forced_tool_choice 降级）
 *   - Partial draft 救援触发
 *
 * 内置 loggerSink（默认，落日志文件）与 consoleSink（终端调试）；远程上报
 * （Sentry / 自建端点）留扩展点 —— D-0046 决策推迟到多 agent 上线后真有需要再加。
 * 所有 sink 通过 createTelemetry compose，dispatch / agent_loop 视它为不透明 sink，
 * 只调 emit()。
 */

import type { ShapeRepairKind } from "./tool_args_repair.js";
import { getLogger, hasLogger } from "../logger/index.js";

// ---------------------------------------------------------------------------
// Event types — discriminated union，新增事件加新 kind 不破坏旧 sink
// ---------------------------------------------------------------------------

export type TelemetryEvent =
  /** Layer 1 (tool_args_repair) 触发了形状修复或 markdown 链接拆解 */
  | {
      kind: "tool_input_repaired";
      agentName: string;
      toolName: string;
      repairKind: ShapeRepairKind;
      field: (string | number)[];
    }
  /** Layer 1 修复后仍校验失败（dispatch 注 retryHint 让 LLM 重试） */
  | {
      kind: "tool_input_invalid";
      agentName: string;
      toolName: string;
      remainingIssueCount: number;
    }
  /** Agent loop 跑到 maxIter 仍未到 terminal */
  | { kind: "agent_iter_max_reached"; agentName: string; iterCount: number }
  /** chat_reply 偏离 guard 触发（业务侧判 user input 不像写章节但 LLM 走 text path） */
  | { kind: "chat_reply_deviation_guard"; agentName: string; count: number; iter: number }
  /** EMPTY_RESPONSE guard 触发（!hasFullText && !hasTools） */
  | { kind: "empty_response_guard"; agentName: string; count: number; iter: number }
  /** 文本路径同时有 mutating tool（fullText 当解释丢弃，不写章节 draft） */
  | { kind: "double_emit_with_mutating_tool"; agentName: string; fullTextLen: number }
  /** forceToolOnly 但同时收到 fullText（按 LLM 决策走 tool 路径，text 丢弃） */
  | { kind: "force_tool_only_with_text"; agentName: string; fullTextLen: number }
  /** Catch 路径救回 partial draft */
  | { kind: "partial_draft_rescued"; agentName: string; label: string; len: number }
  /** Provider 拒收 forced tool_choice，dispatch 自动降级到 "auto" 重试 */
  | { kind: "forced_tool_choice_fallback"; agentName: string; model: string };

export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
}

// ---------------------------------------------------------------------------
// Built-in sinks
// ---------------------------------------------------------------------------

/**
 * Console sink —— emit 到 console.info（不是 console.warn，避免被监控当 error）。
 * 格式：[telemetry] <kind> <JSON 字段>
 *
 * 测试 / 开发时直接看终端；生产默认走 loggerSink（见下）。
 */
export const consoleSink: TelemetrySink = {
  emit(event) {
    const { kind, ...rest } = event;
    // biome-ignore lint/suspicious/noConsole: console sink 的本职就是打 console（测试/开发用，生产走 loggerSink）
    console.info(`[telemetry] ${kind}`, rest);
  },
};

/**
 * 退化路径事件集合 —— 这些 kind 表示 agent 已偏离正常轨道（触顶 / guard / 降级 /
 * 救援），进日志文件时用 warn 级（此前 console 时代刻意压成 info 是怕被监控当
 * error；文件日志无此顾虑，warn 让「导出日志排障」一眼看到退化点）。
 */
const DEGRADED_EVENT_KINDS: ReadonlySet<TelemetryEvent["kind"]> = new Set([
  "agent_iter_max_reached",
  "chat_reply_deviation_guard",
  "empty_response_guard",
  "double_emit_with_mutating_tool",
  "partial_draft_rescued",
  "forced_tool_choice_fallback",
]);

/**
 * Logger sink（生产默认）—— logger 就绪时事件落日志文件（可随「导出日志」带走），
 * 退化路径 warn 级、常规观测 info 级；logger 未就绪降级 console.info。
 */
export const loggerSink: TelemetrySink = {
  emit(event) {
    const { kind, ...rest } = event;
    if (hasLogger()) {
      const logger = getLogger();
      if (DEGRADED_EVENT_KINDS.has(kind)) {
        logger.warn("telemetry", kind, rest as Record<string, unknown>);
      } else {
        logger.info("telemetry", kind, rest as Record<string, unknown>);
      }
      return;
    }
    // biome-ignore lint/suspicious/noConsole: sanctioned 降级出口——logger 未就绪时保诊断不丢
    console.info(`[telemetry] ${kind}`, rest);
  },
};

/**
 * Compose 多个 sink fan-out emit。dispatch / agent_loop 总是拿一个 sink，sink
 * 内部可以是 single 或 composed —— 调用方看不到差异。
 *
 * 默认 sinks=[loggerSink]，dispatch 不传 telemetry 参数时用此 fallback（logger
 * 就绪进日志文件，未就绪行为等同旧 consoleSink，但格式结构化）。
 *
 * 单个 sink emit 抛错不阻塞其它 sink 也不阻塞业务（telemetry 永远是 fire-and-forget，
 * 不能因为日志 sink 挂了导致 agent dispatch 中断）。
 */
export function createTelemetry(sinks: TelemetrySink[] = [loggerSink]): TelemetrySink {
  return {
    emit(event) {
      for (const sink of sinks) {
        try {
          sink.emit(event);
        } catch {
          /* sink 自己出错不阻塞业务，silent ignore */
        }
      }
    },
  };
}
