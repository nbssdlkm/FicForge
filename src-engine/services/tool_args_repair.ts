// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Tool args repair pipeline —— FicForge agent harness Layer 1.
 *
 * 实现 Awais (CommandCode) 帖子的 6 步流程 + 4 类形状修复 + Markdown 链接拆解。
 * 详见 docs/internal/references/2026-05-05-commandcode-deepseek-tool-calling.md
 *
 * 5 准则（违反任何一条都是 bug）：
 *   1. 合法输入绝不碰（schema fail first，不预处理 valid value）
 *   2. 只在报错的字段路径上做修复
 *   3. 修复有顺序约束（parse_json_string 必须先于 wrap_bare）
 *   4. 不能修就给模型可读的重试提示，绝不打 `Error:` 前缀（TUI / 客户端会标红）
 *   5. 修复全程 trace，方便上层 telemetry 落 tool_input_repaired:{toolName}:{kind}
 *
 * 例外：路径字段（pathFields option）走 pre-pass markdown 拆解 —— Awais 帖子
 * 第 2 节 pathString() 等价物。这是 schema 之外的字段类型语义，不算 "猜哪里坏了"。
 */

import type { ZodIssue, ZodType } from "zod";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ShapeRepairKind =
  | "parse_json_string_array"
  | "unwrap_array_placeholder"
  | "wrap_bare_to_array"
  | "drop_null_optional"
  | "strip_degenerate_markdown_link"
  | "salvage_malformed_json";

export interface RepairTrace {
  field: (string | number)[];
  kind: ShapeRepairKind;
  before: unknown;
  after: unknown;
}

export interface RepairResult<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  repairs: RepairTrace[];
  /** success=false 时残余 issues，供日志 / 高层降级判定 */
  remainingIssues: ZodIssue[];
  /**
   * 给模型的重试提示。已加 `注意：` 前缀避免被 TUI 当 fatal error 标红 +
   * 防止模型把它当成"调用失败"中止 reasoning。dispatch 把这串放进 tool result
   * 喂回 LLM，下一轮 LLM 据此修正。
   */
  retryHint?: string;
}

export interface RepairOptions {
  /**
   * 显式声明哪些字段是路径字段（每个元素是字段路径，dot-notation 风格的 path 数组）。
   * 这些字段在 schema 校验前跑 Markdown 链接拆解 pre-pass。
   * 例：[["file_path"], ["filename"]]
   *
   * 不靠 schema metadata 是为了保持 schema 纯净 + 让"哪些是路径"的决定显式化（避免
   * 未来被人不假思索地给所有 string 字段加 path 语义）。
   */
  pathFields?: (string | number)[][];
}

// ---------------------------------------------------------------------------
// Path helpers (immutable get / set / delete by path)
// ---------------------------------------------------------------------------

function getAtPath(obj: unknown, path: (string | number)[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

function cloneShallow(value: unknown): unknown {
  if (Array.isArray(value)) return [...value];
  if (value !== null && typeof value === "object") return { ...(value as object) };
  return value;
}

function setAtPath(obj: unknown, path: (string | number)[], value: unknown): unknown {
  if (path.length === 0) return value;
  const result = cloneShallow(obj) as Record<string | number, unknown>;
  let cur: Record<string | number, unknown> = result;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    cur[seg] = cloneShallow(cur[seg]);
    cur = cur[seg] as Record<string | number, unknown>;
  }
  cur[path[path.length - 1]] = value;
  return result;
}

function deleteAtPath(obj: unknown, path: (string | number)[]): unknown {
  if (path.length === 0) return obj;
  const result = cloneShallow(obj) as Record<string | number, unknown>;
  let cur: Record<string | number, unknown> = result;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    cur[seg] = cloneShallow(cur[seg]);
    cur = cur[seg] as Record<string | number, unknown>;
  }
  delete cur[path[path.length - 1]];
  return result;
}

// ---------------------------------------------------------------------------
// Malformed-JSON salvage（model-agnostic 兜底，只在严格 JSON.parse 已失败后跑）
// ---------------------------------------------------------------------------

/**
 * 抢救「字符串值里含字面控制字符」写坏的 tool-call JSON —— LLM 把跨行原文逐字抄进字符串
 * 字段时的高频失败（如 M9 提取的 evidence 字段：真换行 / 制表符不转义 → JSON.parse 失败 →
 * 整批提取丢空）。**仅在标准 JSON.parse 已抛错后调用**（合法输入永不进这里，零回归风险）；
 * 抢救后仍需再 JSON.parse 验证，失败则返回 null 走原有 retryHint 路径。model-agnostic。
 *
 * **只处理无歧义的一类：串内字面控制字符（<0x20）补转义。** 刻意**不**去猜「未转义引号」是
 * 内容还是闭合 —— 那本质歧义（`内容"，...` 与 `值闭合"，下一键` 局部无法区分），猜错会**静默
 * 截断**字符串值再让残余 JSON 恰好 parse 成功、写进错数据（对抗审 HIGH）。这里对所有 `"` 一律
 * 按标准 JSON 语义当闭合：若某个其实是内容引号，串状态会错位、再 parse 必然失败 → 安全回退
 * retryHint，绝不静默改数据（"首先，不伤害"）。未转义引号交给 Layer A（短、单行、免引号的
 * evidence）压低发生率 + 模型重试兜底。
 *
 * 单趟状态机（JSON 无嵌套字符串，状态只有「在串内 / 串外」）：
 *   - 串内遇 `\`：合法转义序列，原样复制它和下一个字符（不误判 `\"` / `\\`）。
 *   - 串内遇 `"`：按标准 JSON 当闭合，退出串。
 *   - 串内遇字面控制字符（<0x20）：补成 `\n` / `\t` / `\r` / `\uXXXX`（JSON 规范里必须转义）。
 *
 * 只有真正补过转义才返回新串（没改 = 畸形不属本类，返回 null 不重复 parse）。
 */
export function salvageMalformedJson(raw: string): string | null {
  let out = "";
  let inStr = false;
  let changed = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (!inStr) {
      out += ch;
      if (ch === '"') inStr = true;
      continue;
    }
    // ----- 串内 -----
    if (ch === "\\") {
      // 合法转义序列：原样带走 `\` 和其后一个字符
      out += ch;
      if (i + 1 < raw.length) {
        out += raw[i + 1];
        i++;
      }
      continue;
    }
    if (ch === '"') {
      // 标准闭合（不猜内容引号——见函数注释）
      out += ch;
      inStr = false;
      continue;
    }
    const code = raw.charCodeAt(i);
    if (code < 0x20) {
      if (ch === "\n") out += "\\n";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\r") out += "\\r";
      else out += "\\u" + code.toString(16).padStart(4, "0");
      changed = true;
      continue;
    }
    out += ch;
  }
  return changed ? out : null;
}

// ---------------------------------------------------------------------------
// Markdown link strip
// ---------------------------------------------------------------------------

/**
 * 拆解"链接文本和 URL 几乎一致"的退化 markdown 链接。真正的 markdown 链接
 * （text 和 url 不同）保留不动。
 *
 * 触发条件（任一即视为退化）：
 *   - text === url
 *   - url 去掉常见前缀（http(s):// / file:// / ./ / 起首 /）后等于 text
 *   - url 末尾 basename 等于 text
 *
 * 例：
 *   "[notes.md](http://notes.md)"             → "notes.md"
 *   "/Users/x/proj/[notes.md](http://notes.md)" → "/Users/x/proj/notes.md"
 *   "[click here](http://example.com)"         → 不动
 */
function stripDegenerateMdLink(s: string): string {
  return s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, text: string, url: string) => {
    const t = text.trim();
    const u = url.trim();
    if (t === u) return t;
    const uStripped = u.replace(/^(https?:\/\/|file:\/\/|\.\/|\/)/, "");
    if (t === uStripped) return t;
    const uBasename = uStripped.split(/[\/\\]/).pop() ?? uStripped;
    if (t === uBasename) return t;
    return full;
  });
}

function applyMarkdownStripPass(
  obj: unknown,
  pathFields: (string | number)[][],
): { newObj: unknown; traces: RepairTrace[] } {
  let current = obj;
  const traces: RepairTrace[] = [];
  for (const path of pathFields) {
    const value = getAtPath(current, path);
    if (typeof value !== "string") continue;
    const stripped = stripDegenerateMdLink(value);
    if (stripped !== value) {
      current = setAtPath(current, path, stripped);
      traces.push({
        field: [...path],
        kind: "strip_degenerate_markdown_link",
        before: value,
        after: stripped,
      });
    }
  }
  return { newObj: current, traces };
}

// ---------------------------------------------------------------------------
// Optional probe
// ---------------------------------------------------------------------------

/**
 * 检查 schema 在指定路径上的字段是否 optional（可省略 / 接受 undefined）。
 *
 * 实现：safeParse 一个空对象，若整 schema 通过 → 字段必为 optional；若 schema 失败
 * 但失败的 issues 里**没有**该字段在 path 上的 required 报错（invalid_type +
 * received='undefined'）→ 也视为 optional。
 *
 * 限制：仅顶层字段路径（path.length === 1）准确；嵌套路径返回 false（保守）。
 * 非 z.object schema（union / intersection / refine）也可能 false negative。
 * 安全侧失败 = 判 required → 不删 null → 让 schema fail → 走 retry hint 路径，
 * 不会造成 silent corruption。
 */
function isOptionalAtPath(schema: ZodType, path: (string | number)[]): boolean {
  if (path.length !== 1) return false;
  const fieldName = path[0];
  const probe: Record<string | number, unknown> = {};
  const result = schema.safeParse(probe);
  if (result.success) return true;
  return !result.error.issues.some((iss) => {
    if (iss.path.length !== 1 || iss.path[0] !== fieldName) return false;
    if (iss.code !== "invalid_type") return false;
    // zod 4: received 在 invalid_type 里。undefined 表示字段缺失（required）
    const recv = (iss as unknown as { received?: string }).received;
    return recv === "undefined";
  });
}

// ---------------------------------------------------------------------------
// Per-issue repair
// ---------------------------------------------------------------------------

function tryRepairForIssue(
  obj: unknown,
  issue: ZodIssue,
  schema: ZodType,
): { newObj: unknown; trace: RepairTrace } | null {
  if (issue.code !== "invalid_type") return null;

  // Zod 4 ZodIssue.path 类型为 PropertyKey[]（含 symbol）。我们的 obj 是 JSON.parse
  // 产出的对象，路径只可能是 string / number；filter symbol 安全 narrow，下游路径
  // helpers 全部使用此 narrow 后的 path 变量。
  const path = issue.path.filter((p): p is string | number => typeof p !== "symbol");

  const fieldValue = getAtPath(obj, path);
  // zod 4 ZodIssue.invalid_type 仅含 expected（type 名），不含 received。
  // 我们改靠 fieldValue 的实际类型判断 —— 比依赖 issue 字段更可靠。
  // （Awais 帖子原意也是"看 issue list 定位字段路径"，type narrowing 自然落到值本身。）
  const expected = (issue as unknown as { expected?: string }).expected;

  // 路径 1：期望数组（修复 #2 / #3 / #4 都在这里）
  if (expected === "array") {
    // 字符串：先尝试 parse JSON 数组，失败再 wrap_bare（顺序约束）
    if (typeof fieldValue === "string") {
      try {
        const parsed = JSON.parse(fieldValue);
        if (Array.isArray(parsed)) {
          return {
            newObj: setAtPath(obj, path, parsed),
            trace: {
              field: [...path],
              kind: "parse_json_string_array",
              before: fieldValue,
              after: parsed,
            },
          };
        }
      } catch {
        /* fall through */
      }
      return {
        newObj: setAtPath(obj, path, [fieldValue]),
        trace: {
          field: [...path],
          kind: "wrap_bare_to_array",
          before: fieldValue,
          after: [fieldValue],
        },
      };
    }
    // 对象（非 null / 非 array）：仅当空对象 {} placeholder 时换成 []
    // 非空对象（如 {x:1}）不动 —— 那是模型把 schema 完全搞错了，要 retry hint
    if (
      typeof fieldValue === "object" &&
      fieldValue !== null &&
      !Array.isArray(fieldValue) &&
      Object.keys(fieldValue as object).length === 0
    ) {
      return {
        newObj: setAtPath(obj, path, []),
        trace: {
          field: [...path],
          kind: "unwrap_array_placeholder",
          before: fieldValue,
          after: [],
        },
      };
    }
  }

  // 路径 2：可选字段强传 null（任何 expected 类型都可能命中，因为 null 永远 invalid_type）
  if (fieldValue === null) {
    if (isOptionalAtPath(schema, path)) {
      return {
        newObj: deleteAtPath(obj, path),
        trace: {
          field: [...path],
          kind: "drop_null_optional",
          before: null,
          after: undefined,
        },
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Retry hint builder
// ---------------------------------------------------------------------------

function buildRetryHint(toolName: string, issues: ZodIssue[]): string {
  // 准则 4：用 "注意：" 前缀，不用 "Error:"。模型读到 "注意" 不会中断 reasoning
  // 直接修正参数后下一轮重发。
  const lines = issues.slice(0, 5).map((iss) => {
    const fieldStr = iss.path.length > 0 ? iss.path.join(".") : "(root)";
    return `  - 字段 \`${fieldStr}\`: ${iss.message}`;
  });
  const more = issues.length > 5 ? `  ...另有 ${issues.length - 5} 条问题` : "";
  return [`注意：工具 ${toolName} 的参数有以下问题，请下一轮调用时修正：`, ...lines, more].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * 6 步流程：
 *   ① parse JSON string → object（失败给 hint）
 *   ② 路径字段 markdown 拆解 pre-pass（pathFields option，可选）
 *   ③ 原样校验 —— 通过则直接返回（合法输入绝不碰，准则 1）
 *   ④ 失败看 issue list，按字段路径定向修复（准则 2 + 3）
 *   ⑤ 修完再校验
 *   ⑥ 还过不了 → 返回 retryHint（准则 4），不抛异常（让 dispatch 决定降级策略）
 */
export function repairAndValidateToolArgs<T>(
  toolName: string,
  rawArgs: string,
  schema: ZodType<T>,
  options: RepairOptions = {},
): RepairResult<T> {
  // 步 ①
  let parsed: unknown;
  const preTraces: RepairTrace[] = [];
  try {
    parsed = JSON.parse(rawArgs || "{}");
  } catch (e) {
    // 抢救兜底：字符串值里未转义引号 / 字面控制字符写坏的 JSON（LLM 逐字抄原文的高频失败）。
    // 只在标准 parse 已失败后跑，抢救后必须再 parse 验证，仍失败才放弃走 retryHint（零回归）。
    const salvaged = salvageMalformedJson(rawArgs || "");
    let recovered = false;
    if (salvaged !== null) {
      try {
        parsed = JSON.parse(salvaged);
        recovered = true;
        preTraces.push({ field: [], kind: "salvage_malformed_json", before: rawArgs, after: salvaged });
      } catch {
        /* 抢救后仍非法 → 放弃 */
      }
    }
    if (!recovered) {
      return {
        success: false,
        repairs: [],
        remainingIssues: [],
        retryHint: `注意：工具 ${toolName} 收到无法解析的 JSON 参数。请重发完整、合法的 JSON 对象。错误：${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      success: false,
      repairs: [],
      remainingIssues: [],
      retryHint: `注意：工具 ${toolName} 参数应为 JSON 对象，收到 ${
        Array.isArray(parsed) ? "数组" : parsed === null ? "null" : typeof parsed
      }。`,
    };
  }

  const allTraces: RepairTrace[] = [...preTraces];
  let current: unknown = parsed;

  // 步 ②
  if (options.pathFields && options.pathFields.length > 0) {
    const { newObj, traces } = applyMarkdownStripPass(current, options.pathFields);
    current = newObj;
    allTraces.push(...traces);
  }

  // 步 ③
  const firstResult = schema.safeParse(current);
  if (firstResult.success) {
    return {
      success: true,
      data: firstResult.data,
      repairs: allTraces,
      remainingIssues: [],
    };
  }

  // 步 ④
  for (const issue of firstResult.error.issues) {
    const attempt = tryRepairForIssue(current, issue, schema);
    if (attempt) {
      current = attempt.newObj;
      allTraces.push(attempt.trace);
    }
  }

  // 步 ⑤
  const secondResult = schema.safeParse(current);
  if (secondResult.success) {
    return {
      success: true,
      data: secondResult.data,
      repairs: allTraces,
      remainingIssues: [],
    };
  }

  // 步 ⑥
  return {
    success: false,
    repairs: allTraces,
    remainingIssues: secondResult.error.issues,
    retryHint: buildRetryHint(toolName, secondResult.error.issues),
  };
}
