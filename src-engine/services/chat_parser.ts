// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * AI 对话格式检测、按角色拆分、轮次分类。
 * 支持 ChatGPT / DeepSeek / Chatbox / SillyTavern 等对话记录的解析。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatFormatPattern {
  name: string;
  userPattern: RegExp;
  assistantPattern: RegExp;
}

export interface ChatTurn {
  index: number;
  role: "user" | "assistant";
  content: string;
  charCount: number;
}

export interface ClassifiedTurn {
  index: number;
  role: "user" | "assistant";
  content: string;
  charCount: number;
  classification: "chapter" | "setting" | "skip" | "uncertain";
  reason: string;
  assignedChapter: number | null;
  assignedType: "chapter" | "chapter_continue" | "setting" | "skip";
}

export interface ClassificationThresholds {
  chapterMinChars: number;
  skipMaxChars: number;
}

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  chapterMinChars: 1500,
  skipMaxChars: 300,
};

// ---------------------------------------------------------------------------
// Known chat formats
// ---------------------------------------------------------------------------

const KNOWN_CHAT_FORMATS: ChatFormatPattern[] = [
  // 英文标记
  {
    name: "User/Assistant",
    userPattern: /^(?:User|Human|You)[:：]\s*/im,
    assistantPattern: /^(?:Assistant|AI|ChatGPT|DeepSeek|Claude)[:：]\s*/im,
  },
  // 中文标记
  {
    name: "用户/助手",
    userPattern: /^(?:用户|我|人类)[:：]\s*/im,
    assistantPattern: /^(?:助手|AI|机器人)[:：]\s*/im,
  },
  // Chatbox 格式
  {
    name: "Chatbox",
    userPattern: /^>\s*(?:User|用户)\s*/im,
    assistantPattern: /^>\s*(?:Assistant|助手)\s*/im,
  },
  // Markdown 标题格式
  {
    name: "Markdown",
    userPattern: /^#{1,3}\s*(?:User|Human|用户)\s*$/im,
    assistantPattern: /^#{1,3}\s*(?:Assistant|AI|ChatGPT|DeepSeek|Claude|助手)\s*$/im,
  },
];

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * 检测文本是否为 AI 对话格式。
 * 每种模式的 user/assistant 标记各至少命中 2 次才认定。
 * 返回第一个命中的格式，全部不命中返回 null。
 */
export function detectChatFormat(content: string): ChatFormatPattern | null {
  if (!content || content.length < 10) return null;

  for (const fmt of KNOWN_CHAT_FORMATS) {
    const userRe = new RegExp(fmt.userPattern.source, "gim");
    const assistantRe = new RegExp(fmt.assistantPattern.source, "gim");
    const userMatches = content.match(userRe);
    const assistantMatches = content.match(assistantRe);
    if (
      userMatches && userMatches.length >= 2 &&
      assistantMatches && assistantMatches.length >= 2
    ) {
      return fmt;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Role-based splitting
// ---------------------------------------------------------------------------

/**
 * 按对话标记拆分文本为轮次数组。
 * 第一个标记之前的内容（如果有且非空白）作为 index=0 的 assistant 前言。
 */
export function splitByRole(content: string, format: ChatFormatPattern): ChatTurn[] {
  // 合并 user 和 assistant 模式为一个正则
  const combinedSource = `(?:${format.userPattern.source})|(?:${format.assistantPattern.source})`;
  const combinedRe = new RegExp(combinedSource, "gim");

  // 找到所有标记的位置
  const markers: { index: number; matchLength: number; role: "user" | "assistant" }[] = [];
  let match: RegExpExecArray | null;
  while ((match = combinedRe.exec(content)) !== null) {
    // 判断是 user 还是 assistant
    const userTest = new RegExp(format.userPattern.source, "im");
    const role: "user" | "assistant" = userTest.test(match[0]) ? "user" : "assistant";
    markers.push({ index: match.index, matchLength: match[0].length, role });
  }

  if (markers.length === 0) return [];

  const turns: ChatTurn[] = [];
  let turnIndex = 0;

  // 第一个标记之前的内容（前言）
  const preamble = content.slice(0, markers[0].index).trim();
  if (preamble.length > 0) {
    turns.push({
      index: turnIndex++,
      role: "assistant",
      content: preamble,
      charCount: preamble.length,
    });
  }

  // 每个标记到下一个标记之间的内容
  for (let i = 0; i < markers.length; i++) {
    const contentStart = markers[i].index + markers[i].matchLength;
    const contentEnd = i + 1 < markers.length ? markers[i + 1].index : content.length;
    const body = content.slice(contentStart, contentEnd).trim();

    turns.push({
      index: turnIndex++,
      role: markers[i].role,
      content: body,
      charCount: body.length,
    });
  }

  return turns;
}

// ---------------------------------------------------------------------------
// Turn classification
// ---------------------------------------------------------------------------

/**
 * 按字数阈值分类轮次。
 * startChapter 用于多文件接续——第二个文件的章节号从这里开始。
 */
export function classifyTurns(
  turns: ChatTurn[],
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
  startChapter: number = 1,
): ClassifiedTurn[] {
  let currentChapter = startChapter;

  return turns.map((t) => {
    // 用户消息默认跳过
    if (t.role === "user") {
      return {
        ...t,
        classification: "skip" as const,
        reason: "用户消息",
        assignedChapter: null,
        assignedType: "skip" as const,
      };
    }

    // AI 回复按字数分类
    if (t.charCount >= thresholds.chapterMinChars) {
      const chapter = currentChapter++;
      return {
        ...t,
        classification: "chapter" as const,
        reason: `${t.charCount} 字 ≥ ${thresholds.chapterMinChars}（正文阈值）`,
        assignedChapter: chapter,
        assignedType: "chapter" as const,
      };
    }

    if (t.charCount <= thresholds.skipMaxChars) {
      return {
        ...t,
        classification: "skip" as const,
        reason: `${t.charCount} 字 ≤ ${thresholds.skipMaxChars}（跳过阈值）`,
        assignedChapter: null,
        assignedType: "skip" as const,
      };
    }

    // 中间长度：标记为 uncertain
    return {
      ...t,
      classification: "uncertain" as const,
      reason: `${t.charCount} 字，介于阈值之间，请手动判断`,
      assignedChapter: null,
      assignedType: "skip" as const,
    };
  });
}

// ---------------------------------------------------------------------------
// JSON chat export parsing
// ---------------------------------------------------------------------------

/**
 * 检测 JSON 数据是否为 AI 对话导出格式。
 * 支持 ChatGPT JSON 导出（mapping 字段）和简单数组格式。
 */
export function isJsonChatExport(data: unknown): boolean {
  if (data === null || typeof data !== "object") return false;

  // ChatGPT 导出格式：有 mapping 字段
  if ("mapping" in (data as Record<string, unknown>)) {
    const mapping = (data as Record<string, unknown>).mapping;
    return typeof mapping === "object" && mapping !== null;
  }

  // 简单数组格式：[{role, content}, ...]
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    return (
      typeof first === "object" &&
      first !== null &&
      "role" in first &&
      "content" in first
    );
  }

  return false;
}

/**
 * 解析 JSON 对话导出为 ChatTurn 数组。
 * 支持 ChatGPT mapping 格式和简单数组格式。
 */
export function parseChatExport(data: unknown): ChatTurn[] {
  if (data === null || typeof data !== "object") return [];

  // ChatGPT mapping 格式
  if ("mapping" in (data as Record<string, unknown>)) {
    return parseChatGptMapping(data as Record<string, unknown>);
  }

  // 简单数组格式
  if (Array.isArray(data)) {
    return parseSimpleArray(data);
  }

  return [];
}

function parseChatGptMapping(data: Record<string, unknown>): ChatTurn[] {
  const mapping = data.mapping as Record<string, unknown>;
  if (!mapping) return [];

  const nodes: { id: string; role: string; content: string; parent?: string }[] = [];

  for (const [id, nodeRaw] of Object.entries(mapping)) {
    const node = nodeRaw as Record<string, unknown>;
    const message = node?.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const author = message.author as Record<string, unknown> | undefined;
    const role = author?.role as string ?? (message.role as string ?? "");
    if (!role || (role !== "user" && role !== "assistant")) continue;

    const contentObj = message.content as Record<string, unknown> | undefined;
    let text = "";
    if (contentObj) {
      const parts = contentObj.parts as string[] | undefined;
      if (Array.isArray(parts)) {
        text = parts.join("\n");
      }
    }
    if (!text.trim()) continue;

    nodes.push({
      id,
      role,
      content: text.trim(),
      parent: node.parent as string | undefined,
    });
  }

  // 按 parent 链排序（简单方法：找到 root，沿 children 链构建顺序）
  // 由于 mapping 结构复杂，退化为按出现顺序
  // ChatGPT 的 mapping 通常已经是有序的
  const turns: ChatTurn[] = [];
  let index = 0;
  for (const node of nodes) {
    const normalizedRole: "user" | "assistant" = node.role === "user" ? "user" : "assistant";
    turns.push({
      index: index++,
      role: normalizedRole,
      content: node.content,
      charCount: node.content.length,
    });
  }

  return turns;
}

function parseSimpleArray(data: unknown[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let index = 0;

  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const role = obj.role as string;
    const content = (obj.content as string ?? "").trim();
    if (!role || !content) continue;

    const normalizedRole: "user" | "assistant" =
      role === "user" || role === "human" ? "user" : "assistant";

    turns.push({
      index: index++,
      role: normalizedRole,
      content,
      charCount: content.length,
    });
  }

  return turns;
}
