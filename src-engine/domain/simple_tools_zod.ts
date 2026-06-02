// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** FicForge Lite simple agent 11 个 tool 的 Zod schema 镜像。**不影响 LLM 看到的 tool 列表**（那个是 settings_tools.ts 的 source of truth）；本模块仅供 tool_args_repair 在 engine 侧做 validate + repair。
 *
 * 设计要点：required string 字段一律用 z.string().min(1) 拒绝空字符串。
 * 旧 validateToolArgs (commit 351f796 前) 用 `v.trim() === ""` 判 missing，
 * Layer 1 接入后必须 schema 自己拒绝空字符串才能保留这个行为 — 否则 LLM 给
 * `{filename:"", new_content:"", change_summary:""}` 都通过 validate，
 * dispatch 走 mutating valid PENDING 路径弹空 ToolCallCard（2026-05-05 真机
 * V2 暴露的 regression）。 */

import { z } from "zod";

/** 通用 helper: required string 必须非空（trim 后 length > 0）。 */
const requiredString = () =>
  z.string().refine((s) => s.trim().length > 0, {
    message: "must be a non-empty string",
  });

export const SIMPLE_TOOL_SCHEMAS: Record<string, z.ZodType> = {
  // -- AU mutating (来自 _AU_TOOLS，过滤 SIMPLE_DISABLED_TOOLS) --

  create_character_file: z.object({
    name: requiredString(),
    aliases: z.array(z.string()).optional(),
    importance: z.enum(["main", "supporting", "minor"]).optional(),
    origin_ref: z.string().optional(),
    content: requiredString(),
  }),

  modify_character_file: z.object({
    filename: requiredString(),
    new_content: requiredString(),
    change_summary: requiredString(),
  }),

  create_worldbuilding_file: z.object({
    name: requiredString(),
    content: requiredString(),
  }),

  modify_worldbuilding_file: z.object({
    filename: requiredString(),
    new_content: requiredString(),
    change_summary: requiredString(),
  }),

  // -- AU mutating (P0 pinned / style) --

  add_pinned_context: z.object({
    content: requiredString(),
  }),

  update_writing_style: z.object({
    field: z.enum(["perspective", "emotion_style", "custom_instructions"]),
    value: requiredString(),
  }),

  // -- Fandom mutating (来自 _FANDOM_TOOLS，simple 跨 fandom 也用) --

  create_core_character_file: z.object({
    name: requiredString(),
    content: requiredString(),
  }),

  modify_core_character_file: z.object({
    filename: requiredString(),
    new_content: requiredString(),
    change_summary: requiredString(),
  }),

  // -- Read-only / view (来自 _SIMPLE_VIEW_TOOLS) --

  show_chapter: z.object({
    chapter_num: z.number().int().min(1),
  }),

  show_setting: z.object({
    file_path: requiredString(),
  }),

  // -- Chat reply (来自 _SIMPLE_REPLY_TOOL) --

  chat_reply: z.object({
    content: requiredString(),
  }),
};

/**
 * 哪些 tool 的哪些字段需要 markdown 链接拆解 pre-pass（pathFields）。
 * 字段路径用 (string|number)[] 数组。
 */
export const SIMPLE_TOOL_PATH_FIELDS: Record<string, (string | number)[][]> = {
  modify_character_file: [["filename"]],
  modify_worldbuilding_file: [["filename"]],
  modify_core_character_file: [["filename"]],
  show_setting: [["file_path"]],
};
