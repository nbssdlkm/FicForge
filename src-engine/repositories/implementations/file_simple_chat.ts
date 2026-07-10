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

import yaml from "js-yaml";
import type { PlatformAdapter } from "../../platform/adapter.js";
import type { SimpleChatFile, SimpleChatMessageEnvelope } from "../../domain/simple_chat.js";
import { createSimpleChatFile, SIMPLE_CHAT_VERSION } from "../../domain/simple_chat.js";
import type { SimpleChatRepository } from "../interfaces/simple_chat.js";
import { atomicWrite, dumpYaml, joinPath, now_utc, obj_to_plain, validateBasePath, withWriteLock } from "../../utils/file_utils.js";
import { warnAlways } from "../../logger/index.js";

const CHAT_FILE_NAME = "simple-chat.yaml";
const WELL_KNOWN_DIR = ".well-known";

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
      messages.push({ ...m, id, timestamp: ts, kind });
    }

    return {
      version: typeof obj.version === "number" ? obj.version : SIMPLE_CHAT_VERSION,
      au_path: typeof obj.au_path === "string" ? obj.au_path : au_id,
      created_at: typeof obj.created_at === "string" ? obj.created_at : now_utc(),
      updated_at: typeof obj.updated_at === "string" ? obj.updated_at : now_utc(),
      messages,
    };
  }

  async save(au_id: string, messages: SimpleChatMessageEnvelope[]): Promise<void> {
    const path = this.chatPath(au_id);
    await withWriteLock(path, async () => {
      // 拿现有 created_at（若有），否则用现在
      let created_at = now_utc();
      try {
        const existing = await this.adapter.exists(path);
        if (existing) {
          const text = await this.adapter.readFile(path);
          const raw = yaml.load(text) as Record<string, unknown> | null;
          if (raw && typeof raw === "object" && typeof raw.created_at === "string") {
            created_at = raw.created_at;
          }
        }
      } catch {
        // 读 created_at 失败就用当前时间，不阻断 save
      }

      const file: SimpleChatFile = {
        version: SIMPLE_CHAT_VERSION,
        au_path: au_id,
        created_at,
        updated_at: now_utc(),
        messages,
      };
      const content = dumpYaml(obj_to_plain(file));
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
        updated_at: now_utc(),
        messages: nextMessages,
      };
      const content = dumpYaml(obj_to_plain(out));
      const dir = path.substring(0, path.lastIndexOf("/"));
      await this.adapter.mkdir(dir);
      await atomicWrite(this.adapter, path, content);
    });
  }

  async clear(au_id: string): Promise<void> {
    await this.save(au_id, []);
  }
}
