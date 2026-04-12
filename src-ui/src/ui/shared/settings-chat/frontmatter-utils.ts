// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 受管 YAML Frontmatter 工具函数。
 * 从 SettingsChatPanel.tsx 提取，纯函数，零状态依赖。
 */

import { coerceString, coerceStringArray } from "./types";

// ---------------------------------------------------------------------------
// 常量 & 类型
// ---------------------------------------------------------------------------

export const CHARACTER_FRONTMATTER_KEYS = ["name", "aliases", "importance", "origin_ref"] as const;
export const CORE_CHARACTER_FRONTMATTER_KEYS = ["name"] as const;

export type ManagedFrontmatterKey = typeof CHARACTER_FRONTMATTER_KEYS[number];

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

export function splitYamlFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const normalized = content.replace(/\r\n/g, "\n").trimStart();
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: null, body: normalized };
  }
  return {
    frontmatter: match[1],
    body: normalized.slice(match[0].length),
  };
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

  if (managedKeys.includes("name") && name) lines.push(`name: ${JSON.stringify(name)}`);
  if (managedKeys.includes("aliases") && aliases.length > 0) {
    lines.push("aliases:");
    aliases.forEach((alias) => {
      lines.push(`  - ${JSON.stringify(alias)}`);
    });
  }
  if (managedKeys.includes("importance") && importance) lines.push(`importance: ${importance}`);
  if (managedKeys.includes("origin_ref") && originRef) lines.push(`origin_ref: ${JSON.stringify(originRef)}`);

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
 */
export function preserveManagedFrontmatter(
  oldContent: string,
  newContent: string,
  managedKeys: readonly ManagedFrontmatterKey[],
): string {
  const { frontmatter: oldFm } = splitYamlFrontmatter(oldContent);
  if (!oldFm) return newContent;

  const keySet = new Set<string>(managedKeys);
  const fields: Record<string, unknown> = {};
  const lines = oldFm.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // aliases 是列表，特殊处理
    if (line.startsWith("aliases:") && keySet.has("aliases")) {
      const aliases: string[] = [];
      i++;
      while (i < lines.length && lines[i].match(/^\s+-\s/)) {
        aliases.push(lines[i].replace(/^\s+-\s+/, "").replace(/^["']|["']$/g, "").trim());
        i++;
      }
      if (aliases.length > 0) fields.aliases = aliases;
      continue;
    }

    // 标量字段：key: value（仅匹配受管 key）
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m && keySet.has(m[1])) {
      fields[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }

    i++;
  }

  if (Object.keys(fields).length === 0) return newContent;
  return applyManagedFrontmatter(newContent, fields, managedKeys);
}
