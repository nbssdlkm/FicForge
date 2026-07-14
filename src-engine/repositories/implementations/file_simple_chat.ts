// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FileSimpleChatRepository — `{au_path}/.well-known/simple-chat.yaml` 读写。
 *
 * 设计要点：
 * - 损坏/不存在均返回空白 SimpleChatFile（chat 是体验数据，不阻塞 panel）
 * - withWriteLock 串行化同 AU save（防 debounced 200ms 间隔的并发覆盖）
 * - YAML lineWidth=-1 让长 message content 不被换行，方便 grep / 人工编辑
 */

import * as yaml from "js-yaml";
import type { PlatformAdapter } from "../../platform/adapter.js";
import type { SimpleChatFile, SimpleChatMessageEnvelope } from "../../domain/simple_chat.js";
import { createSimpleChatFile, SIMPLE_CHAT_VERSION } from "../../domain/simple_chat.js";
import type { SimpleChatRepository } from "../interfaces/simple_chat.js";
import {
  atomicWrite,
  dumpYaml,
  joinPath,
  nowUtc,
  objToPlain,
  validateBasePath,
  withWriteLock,
} from "../../utils/file_utils.js";
import { warnAlways } from "../../logger/index.js";

const CHAT_FILE_NAME = "simple-chat.yaml";
const WELL_KNOWN_DIR = ".well-known";

/**
 * Legacy camelCase → snake_case 消息键迁移表（tolerant-read）。
 *
 * 2026-07 SimpleChatMessage 字段 snake 化前，chat.yaml 里消息键用 camelCase 落盘
 * （文件级键 au_path/created_at/updated_at 一直是 snake，只有消息键是 camel）。
 * get() 读老文件时把这些 camel 键 coalesce 到 snake —— 否则消费方读 snake 拿到
 * undefined，用户对话历史静默读不出（草稿章节号/工具调用/生成元数据全丢）。
 * 写侧 domain 字段已改 snake + objToPlain 逐字落盘，故文件一次 save 即自愈为 snake。
 *
 * 单一真相源：本表键 = domain/simple_chat.ts 里被 rename 的字段的旧名。
 */
const LEGACY_MESSAGE_KEY_MAP: Record<string, string> = {
  chapterNum: "chapter_num",
  draftLabel: "draft_label",
  toolArgs: "tool_args",
  toolCallId: "tool_call_id",
  toolName: "tool_name",
  toolCalls: "tool_calls",
  generatedWith: "generated_with",
  undoMeta: "undo_meta",
  acceptedRevision: "accepted_revision",
  acceptedAt: "accepted_at",
  resultNote: "result_note",
  errorMessage: "error_message",
  filePath: "file_path",
};

/** 嵌套 ToolUndoMeta（在 undo_meta 内）的 legacy camel → snake 键迁移表。 */
const LEGACY_UNDO_META_KEY_MAP: Record<string, string> = {
  factId: "fact_id",
  pinnedIndex: "pinned_index",
  pinnedContent: "pinned_content",
  chapterNum: "chapter_num",
};

/**
 * 按迁移表把一层对象的 legacy camel 键改写为 snake。
 * - 仅当 camel 键实际存在时才动手（不给本无该字段的消息注入 undefined 键，
 *   file_simple_chat.test.ts 的 `undefined` 断言依赖此）
 * - 已有 snake 值时优先保留（新写入不被旧 camel 覆盖）
 * - 惰性复制：无任何 legacy 键则原样返回入参，避免无谓分配
 */
function coalesceLegacyKeys(source: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
  let out = source;
  for (const [camel, snake] of Object.entries(map)) {
    if (!(camel in out)) continue;
    if (out === source) out = { ...source };
    if (!(snake in out) || out[snake] === undefined) {
      out[snake] = out[camel];
    }
    delete out[camel];
  }
  return out;
}

/** 迁移单条 message 的 legacy 键（含嵌套 undo_meta）。返回值可能是入参本身（无 legacy 键时）。 */
function migrateLegacyMessageKeys(m: Record<string, unknown>): Record<string, unknown> {
  let out = coalesceLegacyKeys(m, LEGACY_MESSAGE_KEY_MAP);
  const undo = out.undo_meta;
  if (undo && typeof undo === "object" && !Array.isArray(undo)) {
    const migratedUndo = coalesceLegacyKeys(undo as Record<string, unknown>, LEGACY_UNDO_META_KEY_MAP);
    if (migratedUndo !== undo) {
      if (out === m) out = { ...m };
      out.undo_meta = migratedUndo;
    }
  }
  return out;
}

export class FileSimpleChatRepository implements SimpleChatRepository {
  constructor(private adapter: PlatformAdapter) {}

  private chatPath(au_id: string): string {
    validateBasePath(au_id, "au_id");
    return joinPath(au_id, WELL_KNOWN_DIR, CHAT_FILE_NAME);
  }

  async get(au_id: string): Promise<SimpleChatFile> {
    const path = this.chatPath(au_id);
    let exists = false;
    try {
      exists = await this.adapter.exists(path);
    } catch {
      return createSimpleChatFile({ au_path: au_id });
    }
    if (!exists) {
      return createSimpleChatFile({ au_path: au_id });
    }

    let text: string;
    try {
      text = await this.adapter.readFile(path);
    } catch {
      return createSimpleChatFile({ au_path: au_id });
    }

    let raw: unknown;
    try {
      raw = yaml.load(text);
    } catch (err) {
      // YAML 损坏时降级到空文件，但日志要可见 —— 否则用户外部编辑器破坏格式后
      // 对话历史"静默消失"，无任何提示（v4 盲审 P1-6）。
      warnAlways("simple_chat", `yaml.load failed for ${au_id}; serving empty chat`, {
        error: (err as Error).message,
      });
      return createSimpleChatFile({ au_path: au_id });
    }
    if (!raw || typeof raw !== "object") {
      warnAlways("simple_chat", `non-object root in chat.yaml for ${au_id}; serving empty chat`);
      return createSimpleChatFile({ au_path: au_id });
    }

    const obj = raw as Record<string, unknown>;
    const rawMessages = Array.isArray(obj.messages) ? obj.messages : [];
    const messages: SimpleChatMessageEnvelope[] = [];
    for (const item of rawMessages) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const id = typeof m.id === "string" ? m.id : null;
      const ts = typeof m.timestamp === "string" ? m.timestamp : null;
      const kind = typeof m.kind === "string" ? m.kind : null;
      if (!id || !ts || !kind) continue;
      // tolerant-read：老 chat.yaml 的 camelCase 消息键 coalesce 到 snake（见上方迁移表）
      const migrated = migrateLegacyMessageKeys(m);
      messages.push({ ...migrated, id, timestamp: ts, kind });
    }

    return {
      version: typeof obj.version === "number" ? obj.version : SIMPLE_CHAT_VERSION,
      au_path: typeof obj.au_path === "string" ? obj.au_path : au_id,
      created_at: typeof obj.created_at === "string" ? obj.created_at : nowUtc(),
      updated_at: typeof obj.updated_at === "string" ? obj.updated_at : nowUtc(),
      messages,
    };
  }

  async save(au_id: string, messages: SimpleChatMessageEnvelope[]): Promise<void> {
    const path = this.chatPath(au_id);
    await withWriteLock(path, async () => {
      // 拿现有 created_at（若有），否则用现在
      let createdAt = nowUtc();
      try {
        const existing = await this.adapter.exists(path);
        if (existing) {
          const text = await this.adapter.readFile(path);
          const raw = yaml.load(text) as Record<string, unknown> | null;
          if (raw && typeof raw === "object" && typeof raw.created_at === "string") {
            createdAt = raw.created_at;
          }
        }
      } catch {
        // 读 created_at 失败就用当前时间，不阻断 save
      }

      const file: SimpleChatFile = {
        version: SIMPLE_CHAT_VERSION,
        au_path: au_id,
        created_at: createdAt,
        updated_at: nowUtc(),
        messages,
      };
      const content = dumpYaml(objToPlain(file));
      const dir = path.substring(0, path.lastIndexOf("/"));
      await this.adapter.mkdir(dir);
      // 对话历史无 ops 背书，截断即永损 —— 原子写（审计 H5）
      await atomicWrite(this.adapter, path, content);
    });
  }

  async update(
    au_id: string,
    updater: (messages: SimpleChatMessageEnvelope[]) => SimpleChatMessageEnvelope[],
  ): Promise<void> {
    const path = this.chatPath(au_id);
    await withWriteLock(path, async () => {
      // get() 不取锁，可安全在锁内复用；以磁盘现状为基底，避免调用方拿内存快照
      // 整体覆盖时丢掉别处刚写入的消息（接受标记 vs 防抖 save 的并发场景）。
      const file = await this.get(au_id);
      const nextMessages = updater(file.messages);
      const out: SimpleChatFile = {
        version: SIMPLE_CHAT_VERSION,
        au_path: au_id,
        created_at: file.created_at,
        updated_at: nowUtc(),
        messages: nextMessages,
      };
      const content = dumpYaml(objToPlain(out));
      const dir = path.substring(0, path.lastIndexOf("/"));
      await this.adapter.mkdir(dir);
      await atomicWrite(this.adapter, path, content);
    });
  }

  async clear(au_id: string): Promise<void> {
    await this.save(au_id, []);
  }
}
