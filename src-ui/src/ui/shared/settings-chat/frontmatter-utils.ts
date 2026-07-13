// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 受管 YAML Frontmatter 工具函数。
 * 从 SettingsChatPanel.tsx 提取，纯函数，零状态依赖。
 */

import { dumpFrontmatterKey, safeMatter, splitFrontmatterRaw } from "@ficforge/engine";
import { coerceString, coerceStringArray } from "./types";

// ---------------------------------------------------------------------------
// 常量 & 类型
// ---------------------------------------------------------------------------

export const CHARACTER_FRONTMATTER_KEYS = ["name", "aliases", "importance", "origin_ref"] as const;
export const CORE_CHARACTER_FRONTMATTER_KEYS = ["name"] as const;

/** 分割门已知键 = UI 受管键全集（⊇ 引擎 KNOWN_CHARACTER_META_KEYS）；候选块须含其一才算 frontmatter。 */
const FRONTMATTER_GATE_KEYS: ReadonlySet<string> = new Set(CHARACTER_FRONTMATTER_KEYS);

export type ManagedFrontmatterKey = (typeof CHARACTER_FRONTMATTER_KEYS)[number];

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

export function coerceTrimmedString(value: unknown): string {
  return coerceString(value).trim();
}

export function normalizeDisplayName(value: unknown): string {
  return coerceTrimmedString(value).replace(/\.md$/i, "").trim();
}

// ---------------------------------------------------------------------------
// Frontmatter 解析 & 操作
// ---------------------------------------------------------------------------

/**
 * 委托引擎 splitFrontmatterRaw（R4 架构维 M4：此前此处裸正则自切，缺「正文以 ---
 * 分割线开头被吞」的 H6 防线；引擎侧带已知键门，且与 safeMatter 读路径判据同源）。
 */
export function splitYamlFrontmatter(content: string): { frontmatter: string | null; body: string } {
  return splitFrontmatterRaw(content, FRONTMATTER_GATE_KEYS);
}

export function pruneManagedFrontmatter(frontmatter: string, managedKeys: Set<ManagedFrontmatterKey>): string[] {
  const lines = frontmatter.split("\n");
  const result: string[] = [];
  let skippingAliasItems = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (skippingAliasItems) {
      if (/^\s*-\s+/.test(line) || trimmed === "") {
        continue;
      }
      skippingAliasItems = false;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_]+)\s*:/);
    const key = keyMatch?.[1] as ManagedFrontmatterKey | undefined;

    if (key && managedKeys.has(key)) {
      if (key === "aliases" && /^\s*aliases\s*:\s*$/.test(line)) {
        skippingAliasItems = true;
      }
      continue;
    }

    result.push(line);
  }

  while (result.length > 0 && result[0].trim() === "") result.shift();
  while (result.length > 0 && result[result.length - 1].trim() === "") result.pop();

  return result;
}

export function buildManagedFrontmatterLines(
  fields: Record<string, unknown>,
  managedKeys: readonly ManagedFrontmatterKey[],
): string[] {
  const lines: string[] = [];
  const name = coerceTrimmedString(fields.name);
  const aliases = coerceStringArray(fields.aliases);
  const importance = coerceString(fields.importance);
  const originRef = coerceTrimmedString(fields.origin_ref);

  // 序列化交引擎 dumpFrontmatterKey 真 YAML 单源（TD-021：此前此处 JSON.stringify
  // 手写引号、importance 甚至裸写，与 lore-utils 流式写法构成两份手写序列化）。
  if (managedKeys.includes("name") && name) lines.push(...dumpFrontmatterKey("name", name));
  if (managedKeys.includes("aliases") && aliases.length > 0) lines.push(...dumpFrontmatterKey("aliases", aliases));
  if (managedKeys.includes("importance") && importance) lines.push(...dumpFrontmatterKey("importance", importance));
  if (managedKeys.includes("origin_ref") && originRef) lines.push(...dumpFrontmatterKey("origin_ref", originRef));

  return lines;
}

export function applyManagedFrontmatter(
  content: string,
  fields: Record<string, unknown>,
  managedKeys: readonly ManagedFrontmatterKey[],
): string {
  const { frontmatter, body } = splitYamlFrontmatter(content);
  const managedKeySet = new Set<ManagedFrontmatterKey>(managedKeys);
  const preservedLines = frontmatter ? pruneManagedFrontmatter(frontmatter, managedKeySet) : [];
  const managedLines = buildManagedFrontmatterLines(fields, managedKeys);
  const nextFrontmatter = [...managedLines];

  if (preservedLines.length > 0) {
    if (nextFrontmatter.length > 0) {
      nextFrontmatter.push("");
    }
    nextFrontmatter.push(...preservedLines);
  }

  if (nextFrontmatter.length === 0) {
    return body;
  }

  return ["---", ...nextFrontmatter, "---", "", body.trimStart()].join("\n");
}

/**
 * 从现有文件内容中提取受管 frontmatter 字段，
 * 然后将它们注入到新内容中。用于 modify 路径保留 name/aliases 等元数据。
 *
 * 提取走引擎 safeMatter 真 YAML 解析（TD-021：此前手写行级正则只认块式列表，
 * 流式 `aliases: [a, b]`（别名编辑器旧写法）会被静默丢弃——写读两侧手法漂移的实锤；
 * 真 YAML 解析对块式/流式/引号/转义一视同仁）。
 */
export function preserveManagedFrontmatter(
  oldContent: string,
  newContent: string,
  managedKeys: readonly ManagedFrontmatterKey[],
): string {
  const { data } = safeMatter(oldContent, FRONTMATTER_GATE_KEYS);
  const fields: Record<string, unknown> = {};
  for (const key of managedKeys) {
    if (data[key] !== undefined) fields[key] = data[key];
  }
  if (Object.keys(fields).length === 0) return newContent;
  // 空值语义与旧行为一致：buildManagedFrontmatterLines 只写非空值（aliases 空数组、
  // 空串标量都不落行），无需在此预过滤。
  return applyManagedFrontmatter(newContent, fields, managedKeys);
}
