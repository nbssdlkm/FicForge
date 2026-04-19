// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * AI 对话格式检测、按角色拆分、轮次分类。
 * 支持 ChatGPT / DeepSeek / Chatbox / SillyTavern 等对话记录的解析。
 */

import type { LLMProvider } from "../llm/provider.js";

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

export type ClassificationReason =
  | { type: "user_message" }
  | { type: "long_reply"; charCount: number; threshold: number }
  | { type: "short_reply"; charCount: number; threshold: number }
  | { type: "uncertain"; charCount: number };

export interface ClassifiedTurn {
  index: number;
  role: "user" | "assistant";
  content: string;
  charCount: number;
  classification: "chapter" | "setting" | "skip" | "uncertain";
  reason: ClassificationReason;
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
  // Markdown 标题格式（允许可选冒号；Q/A 单字母要求后面不跟字母避免误命中 "## Question" 等）
  {
    name: "Markdown",
    userPattern: /^#{1,3}\s*(?:User|Human|You|用户|我|人类|问|对方|Q(?![a-zA-Z]))[:：]?\s*/im,
    assistantPattern: /^#{1,3}\s*(?:Assistant|AI|ChatGPT|DeepSeek|Claude|GPT|助手|机器人|答|A(?![a-zA-Z]))[:：]?\s*/im,
  },
  // Markdown 加粗格式：**Human:** / **Human**: / **Human**
  {
    name: "Markdown Bold",
    userPattern: /^\*\*\s*(?:User|Human|You|用户|我|人类|问|对方)\s*[:：]?\s*\*\*\s*[:：]?\s*/im,
    assistantPattern: /^\*\*\s*(?:Assistant|AI|ChatGPT|DeepSeek|Claude|GPT|助手|机器人|答)\s*[:：]?\s*\*\*\s*[:：]?\s*/im,
  },
];

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * 验证 ChatFormatPattern 在文本中能匹配到足够多的轮次（user/assistant 各 ≥ 2）。
 * 这是"文本是否构成对话"的唯一判据：detectChatFormat 和 LLM 兜底路径都复用此函数。
 */
export function validateChatFormat(content: string, format: ChatFormatPattern): boolean {
  const userRe = new RegExp(format.userPattern.source, "gim");
  const assistantRe = new RegExp(format.assistantPattern.source, "gim");
  const userCount = (content.match(userRe) ?? []).length;
  const assistantCount = (content.match(assistantRe) ?? []).length;
  return userCount >= 2 && assistantCount >= 2;
}

/**
 * 检测文本是否为 AI 对话格式。
 * 依次用 KNOWN_CHAT_FORMATS 的每个模式走 validateChatFormat 判据，返回首个命中，全部不命中返回 null。
 */
export function detectChatFormat(content: string): ChatFormatPattern | null {
  if (!content || content.length < 10) return null;
  for (const fmt of KNOWN_CHAT_FORMATS) {
    if (validateChatFormat(content, fmt)) return fmt;
  }
  return null;
}

// ---------------------------------------------------------------------------
// LLM-assisted chat structure detection (fallback when rules fail)
// ---------------------------------------------------------------------------

export interface LlmChatDetectResult {
  isChat: boolean;
  userSample: string | null;
  assistantSample: string | null;
}

/**
 * 用 LLM 判断文本是否为对话/问答记录，并返回每轮 user/assistant 行首的字面量样本。
 * 规则检测（detectChatFormat）失败时的兜底。采样前 3000 字，pattern 识别足够。
 * 调用失败、JSON 解析失败、非对话等情况统一返回 isChat=false。
 */
export async function llmDetectChatStructure(
  content: string,
  llmProvider: LLMProvider,
): Promise<LlmChatDetectResult> {
  const sample = content.slice(0, 3000);
  // Few-shot prompt：对话 + 纯正文两个示例 → 弱模型也能稳定输出结构
  const prompt = `判断以下文本是否为**人机对话或问答记录**（而非小说正文/普通文章）。

如果是对话，请从原文中找出每轮 user（提问者/用户）和 assistant（回答者/AI）**行首的字面量标识**，要求：
- 必须是原文中**逐字符出现**的字符串，含冒号、星号、Markdown heading 前缀等
- 每轮 user 和每轮 assistant 各自有**稳定一致**的行首字面量；否则视为非对话

示例 1（对话）：
\`\`\`
**Human:** 写第一章
**Assistant:** [长回复]
**Human:** 继续
**Assistant:** [长回复]
\`\`\`
输出：{"isChat": true, "userSample": "**Human:**", "assistantSample": "**Assistant:**"}

示例 2（纯正文）：
\`\`\`
第一章 黄昏
落日斜挂天际...
第二章 黎明
晨光初现...
\`\`\`
输出：{"isChat": false, "userSample": null, "assistantSample": null}

用 JSON 回答，只返回 JSON，不要多余文字或 markdown fence。格式：
{"isChat": true 或 false, "userSample": "字面量或 null", "assistantSample": "字面量或 null"}

文本：
${sample}`;

  try {
    const response = await llmProvider.generate({
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 200,
      top_p: 1,
    });
    const result = extractJsonResult(response.content);
    if (!result || !result.isChat || !result.userSample || !result.assistantSample) {
      return { isChat: false, userSample: null, assistantSample: null };
    }
    return {
      isChat: true,
      userSample: String(result.userSample),
      assistantSample: String(result.assistantSample),
    };
  } catch (err) {
    // LLM 调用或 JSON 解析失败时降级为"非对话"，避免中断导入；warn 保留线索便于排查
    console.warn("[import] llmDetectChatStructure failed, falling back to non-chat:", err);
    return { isChat: false, userSample: null, assistantSample: null };
  }
}

/**
 * 从 LLM 响应中提取 JSON 对象。
 * 宽容处理：markdown fence、前后多余文字（"好的，这是结果：{...}希望有帮助"）等常见 LLM 输出模式。
 * 策略：剥离 fence 后取第一个 `{` 到最后一个 `}` 的子串 JSON.parse；失败返回 null。
 */
function extractJsonResult(raw: string): Partial<LlmChatDetectResult> | null {
  const cleaned = raw.trim().replace(/```json\s*|```\s*/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Partial<LlmChatDetectResult>;
  } catch {
    return null;
  }
}

/**
 * 用 LLM 返回的字面量样本构造 ChatFormatPattern。
 * 两个 sample 相同/为空时返回 null（LLM 出错兜底）。
 */
export function buildChatFormatFromSamples(
  userSample: string,
  assistantSample: string,
): ChatFormatPattern | null {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const uTrim = userSample.trim();
  const aTrim = assistantSample.trim();
  if (!uTrim || !aTrim || uTrim === aTrim) return null;

  return {
    name: "LLM Detected",
    userPattern: new RegExp(`^${escape(uTrim)}\\s*`, "im"),
    assistantPattern: new RegExp(`^${escape(aTrim)}\\s*`, "im"),
  };
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
        reason: { type: "user_message" as const },
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
        reason: { type: "long_reply" as const, charCount: t.charCount, threshold: thresholds.chapterMinChars },
        assignedChapter: chapter,
        assignedType: "chapter" as const,
      };
    }

    if (t.charCount <= thresholds.skipMaxChars) {
      return {
        ...t,
        classification: "skip" as const,
        reason: { type: "short_reply" as const, charCount: t.charCount, threshold: thresholds.skipMaxChars },
        assignedChapter: null,
        assignedType: "skip" as const,
      };
    }

    // 中间长度：标记为 uncertain
    return {
      ...t,
      classification: "uncertain" as const,
      reason: { type: "uncertain" as const, charCount: t.charCount },
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

// 角色白名单
const USER_ROLES = new Set(["user", "human"]);
const ASSISTANT_ROLES = new Set(["assistant", "ai", "chatgpt", "deepseek"]);
const SKIP_ROLES = new Set(["system", "tool", "function"]);

function normalizeRole(role: string): "user" | "assistant" | null {
  const lower = role.toLowerCase();
  if (USER_ROLES.has(lower)) return "user";
  if (ASSISTANT_ROLES.has(lower)) return "assistant";
  if (SKIP_ROLES.has(lower)) return null;
  return null; // 未知角色也跳过
}

function parseChatGptMapping(data: Record<string, unknown>): ChatTurn[] {
  const mapping = data.mapping as Record<string, unknown>;
  if (!mapping) return [];

  // 按 parent/children 链 DFS 遍历，保证正确对话顺序
  // 找根节点：parent 为 null 或 parent 不在 mapping 中
  const nodeIds = new Set(Object.keys(mapping));
  let rootId: string | null = null;
  for (const [id, nodeRaw] of Object.entries(mapping)) {
    const node = nodeRaw as Record<string, unknown>;
    const parent = node.parent as string | undefined;
    if (!parent || !nodeIds.has(parent)) {
      rootId = id;
      break;
    }
  }

  if (!rootId) {
    // 找不到根节点，退化为按 entries 顺序
    rootId = Object.keys(mapping)[0];
  }

  const turns: ChatTurn[] = [];
  let index = 0;

  function dfs(nodeId: string) {
    const nodeRaw = mapping[nodeId] as Record<string, unknown> | undefined;
    if (!nodeRaw) return;

    const message = nodeRaw.message as Record<string, unknown> | undefined;
    if (message) {
      const author = message.author as Record<string, unknown> | undefined;
      const role = author?.role as string ?? (message.role as string ?? "");
      const normalized = normalizeRole(role);

      if (normalized) {
        const contentObj = message.content as Record<string, unknown> | undefined;
        let text = "";
        if (contentObj) {
          const parts = contentObj.parts as unknown[] | undefined;
          if (Array.isArray(parts)) {
            text = parts.filter((p) => typeof p === "string").join("\n");
          }
        }
        if (text.trim()) {
          turns.push({
            index: index++,
            role: normalized,
            content: text.trim(),
            charCount: text.trim().length,
          });
        }
      }
    }

    // 遍历 children
    const children = nodeRaw.children as string[] | undefined;
    if (Array.isArray(children)) {
      for (const childId of children) {
        dfs(childId);
      }
    }
  }

  // 检查是否有 children 链接——如果没有（简化的 mapping），退化为全量遍历
  const hasChildrenLinks = Object.values(mapping).some(
    (n) => Array.isArray((n as Record<string, unknown>)?.children) && ((n as Record<string, unknown>).children as string[]).length > 0,
  );

  if (hasChildrenLinks && rootId) {
    dfs(rootId);
  } else {
    // 无 children 链接，按 entries 顺序遍历所有节点
    for (const nodeId of Object.keys(mapping)) {
      dfs(nodeId);
    }
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

    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) continue; // 跳过 system/tool/function 等

    turns.push({
      index: index++,
      role: normalizedRole,
      content,
      charCount: content.length,
    });
  }

  return turns;
}
