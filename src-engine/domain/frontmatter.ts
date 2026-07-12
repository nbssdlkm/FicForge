// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * gray-matter 的安全包装（审计 H6 + M27 + B-1/B-2/B-3）。
 *
 * 所有 frontmatter 解析点必须走 safeMatter，不允许裸调 matter(raw)：
 * - H6：正文以 `---` 场景分割线开头时，gray-matter 会把第一段正文吞成
 *   frontmatter（data 变成字符串等非对象、content 残缺，YAML 非法时直接抛），
 *   导致文件不可读或正文静默丢失。
 * - M27：无 options 调用会按原文全局缓存并共享 .data 引用，调用方对 data 的
 *   内存补齐会污染缓存，使字节相同的两个文件共享补齐结果。传 {} 绕缓存；
 *   返回前再浅拷贝 data 双保险，杜绝任何跨调用共享。
 *
 * 写路径同族陷阱（B-1，修法见各调用方）：matter.stringify(string, meta) 的
 * 字符串形式会先把正文按 frontmatter 再解析一遍，`---` 开头的正文在写入时
 * 就被吞掉/搅碎 —— 必须用 matter.stringify({ content }, meta) 对象形式。
 */

import matter from "gray-matter";

/** 排除 Date / 数组 / null 等 YAML 标量能解析出的非字典形态。 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Object.prototype.toString.call(v) === "[object Object]";
}

/**
 * 按「已知键白名单」区分真 frontmatter 与正文误吞。
 *
 * knownKeys 是该文件类型序列化路径实际会写入的键集合（各调用方在自己的
 * 序列化代码旁定义、注明真相源）：本仓库写出的合法 frontmatter 必然含其中
 * 至少一个键，一个已知键都没有时宁可整文当正文，也不吃正文。
 *
 * 所有回退路径统一返回 { data: {}, content: raw }——与「本来就无 frontmatter」
 * 的解析结果同形，调用方依赖 frontmatter 有无的判定（如 provenance）走同一分支。
 */
export function safeMatter(
  raw: string,
  knownKeys: ReadonlySet<string>,
): { data: Record<string, unknown>; content: string } {
  let parsed: { data: unknown; content: string };
  try {
    parsed = matter(raw, {});
  } catch {
    // YAML 非法（如 `---\nfoo: [unclosed\n---`）：整文按纯正文处理
    return { data: {}, content: raw };
  }
  if (!isPlainObject(parsed.data)) {
    // 开头的 `---` 块解析出了字符串/Date 等标量 —— 那是正文分割线，不是 frontmatter
    return { data: {}, content: raw };
  }
  const keys = Object.keys(parsed.data);
  if (keys.length === 0) {
    // B-3：空 frontmatter 块（如 `---\n\n---\n\n正文`）解析出零键对象，但
    // content 已被剥掉两行分割线。本仓库所有序列化路径写 frontmatter 时至少
    // 写一个已知键，零键块只能是正文分割线 —— 整文回退。
    // （无 frontmatter 的文件 parsed.content === raw，返回 raw 等价，无需区分。）
    return { data: {}, content: raw };
  }
  if (!keys.some((k) => knownKeys.has(k))) {
    // 有键值对但没有任何已知元数据键（如正文开头 `---\n时间: 深夜\n---`）
    // —— 按误吞正文处理，整文回退
    return { data: {}, content: raw };
  }
  return { data: { ...parsed.data }, content: parsed.content };
}

/**
 * 保留行序的 frontmatter **原文**分割（R4 架构维 M4：UI 此前用裸正则自切，缺 H6 防线）。
 *
 * 与 safeMatter 的分工：safeMatter 是解析向（返回 data 对象，不保原文行序/注释），
 * 本函数是写路径 line-surgery 向（返回 frontmatter 原文块，供「保留用户未管字段」类改写）。
 * 共享同一 H6 判据思想：切出的候选块必须含至少一个已知键（行级 `key:` 判据），
 * 否则整文当正文 —— 防「正文以 --- 场景分割线开头」被吞成 frontmatter。
 *
 * 行为口径（与 UI 既有 splitYamlFrontmatter 对齐，便于零回归替换）：
 * CRLF 归一为 LF；输入 trimStart 后再匹配；无 frontmatter 时 body = 归一化后的全文。
 */
export function splitFrontmatterRaw(
  raw: string,
  knownKeys: ReadonlySet<string>,
): { frontmatter: string | null; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n").trimStart();
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: null, body: normalized };
  // 「是不是 frontmatter」的裁决直接复用 safeMatter（真 YAML 解析 + 已知键门 + 全部
  // H6/B-3 回退）：safeMatter 只在接受块时返回非空 data。行级正则自扫会与 YAML 语义
  // 分叉（如引号键 `"name":` 合法但正则不认 —— E2 对抗审 codex HIGH 采纳），判据必须单源。
  const verdict = safeMatter(normalized, knownKeys);
  if (Object.keys(verdict.data).length === 0) return { frontmatter: null, body: normalized };
  return { frontmatter: match[1], body: normalized.slice(match[0].length) };
}
