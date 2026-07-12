// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi } from "vitest";
import { consoleSink, createTelemetry, type TelemetrySink, type TelemetryEvent } from "../agent_telemetry.js";

describe("agent_telemetry", () => {
  describe("consoleSink", () => {
    it("emit 调 console.info（不是 console.warn，避免监控误报 error）", () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      consoleSink.emit({
        kind: "tool_input_repaired",
        agentName: "simple_chat",
        toolName: "create_character_file",
        repairKind: "wrap_bare_to_array",
        field: ["aliases"],
      });
      expect(infoSpy).toHaveBeenCalledWith(
        "[telemetry] tool_input_repaired",
        expect.objectContaining({
          agentName: "simple_chat",
          toolName: "create_character_file",
          repairKind: "wrap_bare_to_array",
          field: ["aliases"],
        }),
      );
      expect(warnSpy).not.toHaveBeenCalled();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("kind 字段被剥离，rest 含其它 fields", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      consoleSink.emit({
        kind: "agent_iter_max_reached",
        agentName: "facts_extract",
        iterCount: 5,
      });
      const restArg = spy.mock.calls[0][1] as Record<string, unknown>;
      expect(restArg).not.toHaveProperty("kind");
      expect(restArg).toMatchObject({ agentName: "facts_extract", iterCount: 5 });
      spy.mockRestore();
    });
  });

  describe("createTelemetry", () => {
    it("多 sink fan-out emit", () => {
      const a = vi.fn();
      const b = vi.fn();
      const sink = createTelemetry([{ emit: a }, { emit: b }]);
      const event: TelemetryEvent = {
        kind: "empty_response_guard",
        agentName: "simple_chat",
        count: 1,
        iter: 0,
      };
      sink.emit(event);
      expect(a).toHaveBeenCalledWith(event);
      expect(b).toHaveBeenCalledWith(event);
    });

    it("一个 sink 抛错不影响其它 sink（fire-and-forget）", () => {
      const good = vi.fn();
      const failingSink: TelemetrySink = {
        emit: () => {
          throw new Error("sink failed");
        },
      };
      const sink = createTelemetry([failingSink, { emit: good }]);
      // 不应抛
      expect(() =>
        sink.emit({
          kind: "forced_tool_choice_fallback",
          agentName: "simple_chat",
          model: "deepseek-reasoner",
        }),
      ).not.toThrow();
      expect(good).toHaveBeenCalled();
    });

    it("默认参数走 consoleSink", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const sink = createTelemetry();
      sink.emit({
        kind: "partial_draft_rescued",
        agentName: "simple_chat",
        label: "A",
        len: 3000,
      });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("空 sinks 数组 emit 不抛", () => {
      const sink = createTelemetry([]);
      expect(() =>
        sink.emit({
          kind: "double_emit_with_mutating_tool",
          agentName: "simple_chat",
          fullTextLen: 100,
        }),
      ).not.toThrow();
    });
  });

  describe("Event 类型穷举（TS 编译检查）", () => {
    it("9 种 kind 都能构造（不会跑业务逻辑，仅类型检查）", () => {
      const events: TelemetryEvent[] = [
        { kind: "tool_input_repaired", agentName: "x", toolName: "t", repairKind: "drop_null_optional", field: ["a"] },
        { kind: "tool_input_invalid", agentName: "x", toolName: "t", remainingIssueCount: 2 },
        { kind: "agent_iter_max_reached", agentName: "x", iterCount: 5 },
        { kind: "chat_reply_deviation_guard", agentName: "x", count: 1, iter: 0 },
        { kind: "empty_response_guard", agentName: "x", count: 1, iter: 0 },
        { kind: "double_emit_with_mutating_tool", agentName: "x", fullTextLen: 100 },
        { kind: "force_tool_only_with_text", agentName: "x", fullTextLen: 100 },
        { kind: "partial_draft_rescued", agentName: "x", label: "A", len: 3000 },
        { kind: "forced_tool_choice_fallback", agentName: "x", model: "deepseek-reasoner" },
      ];
      expect(events).toHaveLength(9);
    });
  });
});
