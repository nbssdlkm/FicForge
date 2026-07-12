// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — simple_chat 只读工具执行层（自 simple_chat_dispatch.ts 拆出，E4a）
 *
 * agent loop 自动 fetch 的 read-only 工具实现与读取结果处理：
 *  - executeReadTool：show_chapter / show_setting 自动 fetch（含越界/不存在的机器码分支）
 *  - loadMdDir：characters / worldbuilding 目录 .md 批量读取（上下文组装用）
 *  - truncateReadResultForHistory：注入 internalHistory 的 token 上限截断（融合 plan §1.3 B3）
 *
 * 编排层（simple_chat_dispatch）import 使用；不进 services/index.ts barrel。
 */

import type { PlatformAdapter } from "../platform/adapter.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import { countTokens } from "../tokenizer/index.js";
import { joinPath } from "../utils/file_utils.js";
import { SIMPLE_TOOL_SHOW_CHAPTER, SIMPLE_TOOL_SHOW_SETTING } from "./simple_chat_tools.js";

/**
 * read-only fetch（show_chapter / show_setting）结果注入 internalHistory 的 token 上限
 * （融合 plan §1.3 B3）。
 *
 * 为什么要截断：agent loop 多轮里，LLM 可能连续 show 多个大章节，每个结果都 append 进
 * internalHistory 喂下一轮 —— 不设上限会让 internalHistory 单调增长撑爆 context（组装期
 * assembleChatContext 的 chatHistoryReserve 只为"对话历史"留余量，管不到循环内 fetch）。
 *
 * 截断只作用于 LLM 可见的 internalHistory 副本；emit 给 UI 的 tool_result 仍是全文（持久化
 * 不丢）。正常章节（1500-3000 字 ≈ 2-4k tokens）原样通过；仅病态超长文件被截断，保留头部 +
 * 自然语言截断标记（让 LLM 知道这是节选，可再 show 具体段落）。
 *
 * 实测观察点：MAX_READ_FETCH_TOKENS 是保守上限，若多轮长章节场景仍偏紧可下调。
 */
const MAX_READ_FETCH_TOKENS = 6000;

export function truncateReadResultForHistory(content: string, llm_config: unknown, language: "zh" | "en"): string {
  const tk = (s: string) => countTokens(s, llm_config as { mode?: string }).count;
  const total = tk(content);
  if (total <= MAX_READ_FETCH_TOKENS) return content;
  // 按 token/char 比例首切（留 10% 余量让首切大概率落在预算内），再线性微调（保留头部）。
  let head = content.slice(0, Math.max(1, Math.trunc((content.length * MAX_READ_FETCH_TOKENS * 0.9) / total)));
  while (tk(head) > MAX_READ_FETCH_TOKENS && head.length > 1) {
    head = head.slice(0, Math.trunc(head.length * 0.9));
  }
  const marker =
    language === "en"
      ? "\n\n[... fetched content truncated to fit context; ask to show a specific section if needed ...]"
      : "\n\n[……读取内容过长，已截断以适配上下文；如需具体段落请指明……]";
  return head + marker;
}

/**
 * agent loop read-only tool 自动 fetch 实现。返回 OpenAI tool result content：
 * - 成功：文件原文
 * - 文件不存在：machine-readable code（FILE_NOT_FOUND / CHAPTER_NOT_FOUND），
 *   errorMessage 自然语言放 UI 持久化（不入 OpenAI history 防 LLM 把自然语言当事实）
 * - args 非法：machine-readable INVALID_ARGS code
 *
 * 关键：return content 是 LLM 看到的（机器码 + 必要 hint），errorMessage 是 UI 看到的。
 */
export async function executeReadTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { au_id: string; chapter_repo: ChapterRepository; adapter: PlatformAdapter },
): Promise<{ content: string; errorMessage?: string }> {
  if (toolName === SIMPLE_TOOL_SHOW_CHAPTER) {
    const num = Number(args.chapter_num);
    if (!Number.isInteger(num) || num <= 0) {
      return {
        content: "INVALID_ARGS: chapter_num must be a positive integer.",
        errorMessage: `show_chapter 收到非法 chapter_num：${String(args.chapter_num)}`,
      };
    }
    try {
      const exists = await ctx.chapter_repo.exists(ctx.au_id, num);
      if (!exists) {
        return {
          content: `CHAPTER_NOT_FOUND: chapter ${num} does not exist yet.`,
          errorMessage: `第 ${num} 章不存在`,
        };
      }
      const text = await ctx.chapter_repo.get_content_only(ctx.au_id, num);
      return { content: text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: `READ_FAILED: ${msg}`,
        errorMessage: `读第 ${num} 章失败：${msg}`,
      };
    }
  }

  if (toolName === SIMPLE_TOOL_SHOW_SETTING) {
    const filePath = typeof args.file_path === "string" ? args.file_path.trim() : "";
    if (!filePath) {
      return {
        content: "INVALID_ARGS: file_path is required (e.g., 'characters/Alice.md').",
        errorMessage: "show_setting 收到空 file_path",
      };
    }
    // 防越界访问 AU 之外的文件：file_path 必须以 characters/ worldbuilding/
    // core_characters/ core_worldbuilding/ 开头，否则拒
    // 大小写不敏感比较 —— Windows / macOS fs case-insensitive，LLM 可能产 "Characters/Alice.md"
    // 这种轻微大小写漂移；正常用 lower 形式做白名单 check（v4-pro C3 review P0-3）。
    // 实际访问时保留原 case 让 fs 自己处理（Windows/Mac 大小写不敏感会命中，Linux 大小写敏感
    // 会按 LLM 给的 case 找）。
    const allowedPrefixes = ["characters/", "worldbuilding/", "core_characters/", "core_worldbuilding/"];
    const lowerPath = filePath.toLowerCase();
    if (!allowedPrefixes.some((p) => lowerPath.startsWith(p))) {
      return {
        content: `INVALID_ARGS: file_path must start with one of [${allowedPrefixes.join(", ")}]`,
        errorMessage: `show_setting 路径越界：${filePath}`,
      };
    }
    if (filePath.includes("..")) {
      return {
        content: "INVALID_ARGS: file_path must not contain '..'",
        errorMessage: `show_setting 路径含 '..'：${filePath}`,
      };
    }
    try {
      const fullPath = joinPath(ctx.au_id, filePath);
      const exists = await ctx.adapter.exists(fullPath);
      if (!exists) {
        return {
          content: "FILE_NOT_FOUND",
          errorMessage: `${filePath} 不存在`,
        };
      }
      const text = await ctx.adapter.readFile(fullPath);
      return { content: text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: `READ_FAILED: ${msg}`,
        errorMessage: `读 ${filePath} 失败：${msg}`,
      };
    }
  }

  // 不支持的工具 — 理论上 LLM 不应到这里（dispatch 路由前已分流），但兜底
  return {
    content: `UNSUPPORTED_READ_TOOL: ${toolName}`,
    errorMessage: `executeReadTool 不识别工具：${toolName}`,
  };
}

export async function loadMdDir(adapter: PlatformAdapter, dirPath: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let exists = false;
  try {
    exists = await adapter.exists(dirPath);
  } catch {
    return result;
  }
  if (!exists) return result;
  let files: string[] = [];
  try {
    files = await adapter.listDir(dirPath);
  } catch {
    return result;
  }
  for (const f of files.sort()) {
    if (!f.endsWith(".md")) continue;
    try {
      const content = await adapter.readFile(joinPath(dirPath, f));
      result[f.replace(/\.md$/, "")] = content;
    } catch {}
  }
  return result;
}
