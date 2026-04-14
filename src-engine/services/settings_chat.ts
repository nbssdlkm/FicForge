// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 设定模式 AI 对话服务。参见 D-0024、D-0029。
 * 精简版上下文组装 + LLM tool calling 请求。
 * AI 只建议不执行：返回 tool_calls 原样交给前端。
 */

import { get_tools_for_mode } from "../domain/settings_tools.js";
import { getPrompts } from "../prompts/index.js";
import type { PlatformAdapter } from "../platform/adapter.js";
import type { LLMProvider, Message, ToolCall } from "../llm/provider.js";
import { LLMError } from "../llm/provider.js";
import { hasLogger, getLogger } from "../logger/index.js";
import { joinPath } from "../repositories/implementations/file_utils.js";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// 对话历史截断
// ---------------------------------------------------------------------------

const MAX_HISTORY_MESSAGES = 10;

function truncateHistory(messages: Message[]): Message[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return [...messages];
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

// ---------------------------------------------------------------------------
// Fandom DNA 摘要提取
// ---------------------------------------------------------------------------

const DNA_SECTION_RE = /^##\s*(核心本质|核心特质|Core Essence|Core Traits)/m;

function extractDnaSummary(content: string, maxChars = 1500): string {
  const match = DNA_SECTION_RE.exec(content);
  if (match) {
    const start = match.index;
    const nextHeading = content.indexOf("\n## ", start + 1);
    let section = nextHeading !== -1 ? content.slice(start, nextHeading) : content.slice(start);
    if (section.length > maxChars) section = section.slice(0, maxChars) + "…";
    return section.trim();
  }
  if (content.length > maxChars) return content.slice(0, maxChars) + "…";
  return content.trim();
}

// ---------------------------------------------------------------------------
// 上下文组装
// ---------------------------------------------------------------------------

export interface SettingsChatParams {
  mode: "au" | "fandom";
  base_path: string;
  fandom_path?: string | null;
  messages: Message[];
  language?: string;
  adapter: PlatformAdapter;
}

export async function build_settings_context(params: SettingsChatParams): Promise<Message[]> {
  const { mode, base_path, fandom_path = null, messages, language = "zh", adapter } = params;
  const P = getPrompts(language as "zh" | "en");

  const systemParts: string[] = [];

  if (mode === "au") {
    const [auName, fandomName] = await loadAuMeta(base_path, adapter);
    systemParts.push(
      P.SETTINGS_AU_SYSTEM_PROMPT
        .replace("{au_name}", auName)
        .replace("{fandom_name}", fandomName),
    );

    if (fandom_path) {
      const dnaSummary = await loadFandomDnaSummaries(fandom_path, adapter);
      if (dnaSummary) {
        systemParts.push(`${P.SETTINGS_FANDOM_DNA_HEADER}\n${dnaSummary}`);
      }
    }

    const auContext = await loadAuContext(base_path, language, adapter);
    if (auContext) systemParts.push(auContext);
  } else {
    const fandomName = base_path.split("/").pop() ?? base_path;
    systemParts.push(
      P.SETTINGS_FANDOM_SYSTEM_PROMPT.replace("{fandom_name}", fandomName),
    );

    const fandomFiles = await loadSettingsFiles(base_path, [
      ["core_characters", P.SETTINGS_LABEL_CORE_CHARACTERS],
      ["core_worldbuilding", P.SETTINGS_LABEL_CORE_WORLDBUILDING],
    ], language, adapter);
    if (fandomFiles) {
      systemParts.push(`${P.SETTINGS_CURRENT_FANDOM_FILES_HEADER}\n${fandomFiles}`);
    }
  }

  const systemContent = systemParts.join("\n\n");
  const truncated = truncateHistory(messages);

  return [
    { role: "system", content: systemContent },
    ...truncated,
  ];
}

// ---------------------------------------------------------------------------
// LLM 调用
// ---------------------------------------------------------------------------

export interface SettingsChatResult {
  content: string;
  tool_calls: ToolCall[];
}

export async function call_settings_llm(
  assembled_messages: Message[],
  mode: "au" | "fandom",
  llm_provider: LLMProvider,
): Promise<SettingsChatResult> {
  const tools = get_tools_for_mode(mode);

  // 先尝试带 tool calling 请求；若模型/提供商不兼容则降级为纯文本。
  try {
    const response = await llm_provider.generate({
      messages: assembled_messages,
      max_tokens: 4096,
      temperature: 0.7,
      top_p: 0.95,
      tools: tools as unknown as import("../llm/provider.js").ToolDefinition[],
      tool_choice: "auto",
    });

    return {
      content: response.content,
      tool_calls: response.tool_calls ?? [],
    };
  } catch (err) {
    // 已明确分类的错误（上下文超限、内容过滤、非 400）原样抛出
    if (!(err instanceof LLMError) || err.status_code !== 400) throw err;
    if (err.error_code === "context_length_exceeded" || err.error_code === "content_filtered") throw err;

    // 400 且无明确分类 → 大概率是 tool calling 格式/数量不兼容，去掉 tools 重试
    if (hasLogger()) getLogger().warn("settings_chat", "tool calling 400, retrying without tools", { mode, error: err.message });
    const response = await llm_provider.generate({
      messages: assembled_messages,
      max_tokens: 4096,
      temperature: 0.7,
      top_p: 0.95,
    });

    return {
      content: response.content,
      tool_calls: [],
    };
  }
}

// ---------------------------------------------------------------------------
// 辅助：加载 AU 元数据
// ---------------------------------------------------------------------------

async function loadAuMeta(auPath: string, adapter: PlatformAdapter): Promise<[string, string]> {
  const projectPath = joinPath(auPath, "project.yaml");
  const exists = await adapter.exists(projectPath);
  if (!exists) {
    return [auPath.split("/").pop() ?? auPath, "Unknown"];
  }
  try {
    const text = await adapter.readFile(projectPath);
    const raw = (yaml.load(text) ?? {}) as Record<string, unknown>;
    return [
      (raw.name as string) ?? auPath.split("/").pop() ?? auPath,
      (raw.fandom as string) ?? "Unknown",
    ];
  } catch {
    return [auPath.split("/").pop() ?? auPath, "Unknown"];
  }
}

const SETTINGS_FILES_TOKEN_LIMIT = 30000;

async function loadSettingsFiles(
  baseDir: string,
  categories: [string, string][],
  language: string,
  adapter: PlatformAdapter,
): Promise<string> {
  const entries: [string, string, string][] = []; // [label, filename, content]
  let totalChars = 0;

  for (const [subdir, label] of categories) {
    const dirPath = joinPath(baseDir, subdir);
    const exists = await adapter.exists(dirPath);
    if (!exists) continue;

    const files = await adapter.listDir(dirPath);
    for (const f of files.sort()) {
      if (!f.endsWith(".md")) continue;
      try {
        const content = await adapter.readFile(joinPath(dirPath, f));
        entries.push([label, f, content]);
        totalChars += content.length;
      } catch {
        continue;
      }
    }
  }

  if (entries.length === 0) return "";

  // 超量保护
  let finalEntries = entries;
  if (totalChars > SETTINGS_FILES_TOKEN_LIMIT / 1.5) {
    finalEntries = truncateLowImportance(entries, language);
  }

  return finalEntries.map(([label, filename, content]) => `[${label}] ${filename}:\n${content}`).join("\n\n");
}

function truncateLowImportance(
  entries: [string, string, string][],
  language: string,
): [string, string, string][] {
  return entries.map(([label, filename, content]) => {
    if (hasLowImportance(content)) {
      return [label, filename, extractFrontmatterAndCore(content, language)];
    }
    return [label, filename, content];
  });
}

function hasLowImportance(content: string): boolean {
  if (!content.startsWith("---")) return false;
  try {
    const parts = content.split("---", 3);
    if (parts.length < 3) return false;
    const fm = yaml.load(parts[1]) as Record<string, unknown> | null;
    return fm?.importance === "low";
  } catch {
    return false;
  }
}

function extractFrontmatterAndCore(content: string, language: string): string {
  const P = getPrompts(language as "zh" | "en");
  const parts: string[] = [];

  let remaining = content;
  if (content.startsWith("---")) {
    const fmParts = content.split("---", 3);
    if (fmParts.length >= 3) {
      parts.push(`---${fmParts[1]}---`);
      remaining = fmParts[2];
    }
  }

  // 提取 ## 核心限制 段落（到下一个 ## 标题或文件末尾）
  // 先找标题起始位置
  const headingMatch = remaining.match(/^## (?:核心限制|Core Constraints)/m);
  if (headingMatch && headingMatch.index !== undefined) {
    const start = headingMatch.index;
    // 找下一个 ## 标题
    const nextHeading = remaining.indexOf("\n## ", start + 1);
    const section = nextHeading !== -1 ? remaining.slice(start, nextHeading) : remaining.slice(start);
    parts.push(section.trim());
  }

  if (parts.length === 0) {
    return content.slice(0, 500) + P.SETTINGS_TRUNCATED_SUFFIX;
  }

  return parts.join("\n\n") + P.SETTINGS_TRUNCATED_FULL_SUFFIX;
}

async function loadFandomDnaSummaries(fandomPath: string, adapter: PlatformAdapter): Promise<string> {
  const charsDir = joinPath(fandomPath, "core_characters");
  const exists = await adapter.exists(charsDir);
  if (!exists) return "";

  const files = await adapter.listDir(charsDir);
  const parts: string[] = [];
  for (const f of files.sort()) {
    if (!f.endsWith(".md")) continue;
    try {
      const content = await adapter.readFile(joinPath(charsDir, f));
      const summary = extractDnaSummary(content);
      if (summary) {
        const stem = f.replace(/\.md$/, "");
        parts.push(`### ${stem}\n${summary}`);
      }
    } catch {
      continue;
    }
  }
  return parts.join("\n\n");
}

async function loadAuContext(auPath: string, language: string, adapter: PlatformAdapter): Promise<string> {
  const P = getPrompts(language as "zh" | "en");
  const parts: string[] = [];

  const filesText = await loadSettingsFiles(
    auPath,
    [["characters", P.SETTINGS_LABEL_CHARACTERS], ["worldbuilding", P.SETTINGS_LABEL_WORLDBUILDING]],
    language, adapter,
  );
  if (filesText) {
    parts.push(`${P.SETTINGS_CURRENT_AU_FILES_HEADER}\n${filesText}`);
  }

  // pinned_context + writing_style 从 project.yaml 读取
  const projectPath = joinPath(auPath, "project.yaml");
  const exists = await adapter.exists(projectPath);
  if (exists) {
    try {
      const text = await adapter.readFile(projectPath);
      const raw = (yaml.load(text) ?? {}) as Record<string, unknown>;

      const pinned = (raw.pinned_context as string[]) ?? [];
      if (pinned.length > 0) {
        const lines = pinned.map((p) => `- ${p}`).join("\n");
        parts.push(`${P.SETTINGS_CURRENT_PINNED_HEADER}\n${lines}`);
      }

      const ws = (raw.writing_style ?? {}) as Record<string, unknown>;
      if (ws) {
        const wsParts: string[] = [];
        if (ws.perspective) wsParts.push(`perspective: ${ws.perspective}`);
        if (ws.emotion_style) wsParts.push(`emotion: ${ws.emotion_style}`);
        if (ws.custom_instructions) wsParts.push(`custom: ${ws.custom_instructions}`);
        if (wsParts.length > 0) {
          parts.push(`${P.SETTINGS_CURRENT_STYLE_HEADER}\n${wsParts.join("  |  ")}`);
        }
      }
    } catch {
      // ignore
    }
  }

  return parts.join("\n\n");
}
