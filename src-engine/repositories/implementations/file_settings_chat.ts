// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FileSettingsChatRepository — 设定助手（fandom / AU 设定页 AI 助手）会话持久化。
 *
 * 存储布局（与 chat-sessions 同构，目录独立）：
 * - `{contextPath}/.well-known/settings-chat-sessions/index.yaml` 会话索引
 * - `{contextPath}/.well-known/settings-chat-sessions/{session_id}.yaml` 每会话一份消息
 *
 * 机制与 FileSimpleChatRepository 相同（锁顺序「会话文件锁 → 索引锁」、宽容读、
 * 原子写、title_auto 自动标题）；差异只有消息信封形状（role/content + 透传键）
 * 与无 legacy 迁移（设定助手此前从未落盘）。
 */

import * as yaml from "js-yaml";
import type { PlatformAdapter } from "../../platform/adapter.js";
import type { ChatSessionIndex, ChatSessionMeta } from "../../domain/simple_chat.js";
import {
  CHAT_SESSION_INDEX_VERSION,
  CHAT_SESSION_TITLE_MAX,
  createChatSessionIndex,
} from "../../domain/simple_chat.js";
import type { SettingsChatFile, SettingsChatMessageEnvelope } from "../../domain/settings_chat.js";
import { createSettingsChatFile, deriveSettingsChatTitle, SETTINGS_CHAT_VERSION } from "../../domain/settings_chat.js";
import type { SettingsChatRepository } from "../interfaces/settings_chat.js";
import {
  atomicWrite,
  dumpYaml,
  generateChatSessionId,
  joinPath,
  nowUtc,
  objToPlain,
  validateBasePath,
  withWriteLock,
} from "../../utils/file_utils.js";
import { warnAlways } from "../../logger/index.js";

const WELL_KNOWN_DIR = ".well-known";
const SESSIONS_DIR_NAME = "settings-chat-sessions";
const INDEX_FILE_NAME = "index.yaml";

/** 自动起名前的语言中立占位（与 simple chat 同款约定）。 */
const UNTITLED_FALLBACK = "Session";

/** 会话 id 白名单（防路径穿越；id 由仓储生成，正常必过）。 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class FileSettingsChatRepository implements SettingsChatRepository {
  constructor(private adapter: PlatformAdapter) {}

  // -------------------------------------------------------------------------
  // 路径
  // -------------------------------------------------------------------------

  private sessionsDir(contextPath: string): string {
    validateBasePath(contextPath, "contextPath");
    return joinPath(contextPath, WELL_KNOWN_DIR, SESSIONS_DIR_NAME);
  }

  private indexPath(contextPath: string): string {
    return joinPath(this.sessionsDir(contextPath), INDEX_FILE_NAME);
  }

  private sessionPath(contextPath: string, sessionId: string): string {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      throw new Error(`invalid settings chat session id: ${sessionId}`);
    }
    return joinPath(this.sessionsDir(contextPath), `${sessionId}.yaml`);
  }

  // -------------------------------------------------------------------------
  // 会话文件读写（宽容读 / 原子写）
  // -------------------------------------------------------------------------

  /** 宽容读取一份会话文件；不存在 / 损坏 / 形状非法均回退空白（context_path 已填）。 */
  private async readChatFile(path: string, contextPath: string): Promise<SettingsChatFile> {
    let text: string | null = null;
    try {
      if (await this.adapter.exists(path)) {
        text = await this.adapter.readFile(path);
      }
    } catch {
      return createSettingsChatFile({ context_path: contextPath });
    }
    if (text === null) {
      return createSettingsChatFile({ context_path: contextPath });
    }

    let raw: unknown;
    try {
      raw = yaml.load(text);
    } catch (err) {
      // YAML 损坏时降级到空白，但日志要可见——否则用户外部编辑器破坏格式后
      // 对话历史"静默消失"（与 simple chat 同款教训）。
      warnAlways("settings_chat", `yaml.load failed for ${contextPath}; serving empty session`, {
        error: (err as Error).message,
      });
      return createSettingsChatFile({ context_path: contextPath });
    }
    if (!raw || typeof raw !== "object") {
      warnAlways("settings_chat", `non-object root in session file for ${contextPath}; serving empty session`);
      return createSettingsChatFile({ context_path: contextPath });
    }

    const obj = raw as Record<string, unknown>;
    const rawMessages = Array.isArray(obj.messages) ? obj.messages : [];
    const messages: SettingsChatMessageEnvelope[] = [];
    for (const item of rawMessages) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const id = typeof m.id === "string" ? m.id : null;
      const role = m.role === "user" || m.role === "assistant" ? m.role : null;
      const content = typeof m.content === "string" ? m.content : null;
      if (!id || !role || content === null) continue;
      // 其余键（toolCalls / requestContent）原样透传
      // 透传键里 toolCalls 必须保持数组：外部手编 yaml 写成非标量/字符串时，UI 侧
      // (message.toolCalls || []).some 会直接抛 TypeError 崩渲染（kimi R8 minor）
      const passthrough = { ...m };
      if (passthrough.toolCalls !== undefined && !Array.isArray(passthrough.toolCalls)) {
        delete passthrough.toolCalls;
      }
      messages.push({ ...passthrough, id, role, content });
    }

    return {
      version: typeof obj.version === "number" ? obj.version : SETTINGS_CHAT_VERSION,
      context_path: typeof obj.context_path === "string" ? obj.context_path : contextPath,
      created_at: typeof obj.created_at === "string" ? obj.created_at : nowUtc(),
      updated_at: typeof obj.updated_at === "string" ? obj.updated_at : nowUtc(),
      messages,
    };
  }

  /** 读现有文件的 created_at（save 时保留）；读不到用 null 交给调用方兜底。 */
  private async readCreatedAt(path: string): Promise<string | null> {
    try {
      if (!(await this.adapter.exists(path))) return null;
      const text = await this.adapter.readFile(path);
      const raw = yaml.load(text) as Record<string, unknown> | null;
      if (raw && typeof raw === "object" && typeof raw.created_at === "string") {
        return raw.created_at;
      }
    } catch {
      // 读 created_at 失败不阻断 save
    }
    return null;
  }

  /** 锁内原子写一份会话文件（created_at 保留现有值）。调用方不得再嵌套本路径锁。 */
  private async writeChatFileLocked(
    path: string,
    contextPath: string,
    messages: SettingsChatMessageEnvelope[],
  ): Promise<void> {
    const createdAt = (await this.readCreatedAt(path)) ?? nowUtc();
    const file: SettingsChatFile = {
      version: SETTINGS_CHAT_VERSION,
      context_path: contextPath,
      created_at: createdAt,
      updated_at: nowUtc(),
      messages,
    };
    const content = dumpYaml(objToPlain(file));
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    // 对话历史无 ops 背书，截断即永损——原子写（与 simple chat 同款防护）
    await atomicWrite(this.adapter, path, content);
  }

  // -------------------------------------------------------------------------
  // 索引读写
  // -------------------------------------------------------------------------

  /** 宽容读索引；不存在 / 损坏 / 形状非法返回 null（交由 ensureIndex 重建）。 */
  private async readIndex(contextPath: string): Promise<ChatSessionIndex | null> {
    const path = this.indexPath(contextPath);
    let text: string;
    try {
      if (!(await this.adapter.exists(path))) return null;
      text = await this.adapter.readFile(path);
    } catch {
      return null;
    }
    let raw: unknown;
    try {
      raw = yaml.load(text);
    } catch (err) {
      warnAlways("settings_chat", `yaml.load failed for session index of ${contextPath}; rebuilding`, {
        error: (err as Error).message,
      });
      return null;
    }
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const rawSessions = Array.isArray(obj.sessions) ? obj.sessions : [];
    const sessions: ChatSessionMeta[] = [];
    for (const item of rawSessions) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      if (typeof s.id !== "string" || !SESSION_ID_PATTERN.test(s.id)) continue;
      if (typeof s.title !== "string") continue;
      sessions.push({
        id: s.id,
        title: s.title,
        ...(s.title_auto === true ? { title_auto: true } : {}),
        created_at: typeof s.created_at === "string" ? s.created_at : nowUtc(),
        updated_at: typeof s.updated_at === "string" ? s.updated_at : nowUtc(),
        message_count: typeof s.message_count === "number" && Number.isFinite(s.message_count) ? s.message_count : 0,
      });
    }
    return {
      version: typeof obj.version === "number" ? obj.version : CHAT_SESSION_INDEX_VERSION,
      sessions,
      // 墓碑透传（对称 simple_chat；不丢字段才能跨索引重写存活）
      ...(Array.isArray(obj.retired_session_ids)
        ? { retired_session_ids: obj.retired_session_ids.filter((v): v is string => typeof v === "string") }
        : {}),
    };
  }

  /** 锁内写索引（调用方须已持 indexPath 锁）。 */
  private async writeIndexLocked(contextPath: string, index: ChatSessionIndex): Promise<void> {
    const path = this.indexPath(contextPath);
    const content = dumpYaml(objToPlain(index));
    await this.adapter.mkdir(this.sessionsDir(contextPath));
    await atomicWrite(this.adapter, path, content);
  }

  /** 确保索引存在（幂等）。无 legacy 迁移——设定助手此前从未落盘。 */
  /** 索引文件状态（区分 missing / corrupt——后者需从会话文件抢救重建）。 */
  private async indexFileState(contextPath: string): Promise<"missing" | "ok" | "corrupt"> {
    try {
      if (!(await this.adapter.exists(this.indexPath(contextPath)))) return "missing";
    } catch {
      return "missing";
    }
    return (await this.readIndex(contextPath)) ? "ok" : "corrupt";
  }

  /** 索引损坏时扫会话文件抢救重建（对抗审 2026-09-14 major：不写空索引埋掉会话列表）。 */
  private async rebuildIndexFromSessionFiles(contextPath: string): Promise<ChatSessionIndex> {
    const index = createChatSessionIndex();
    // statEntry 判别「目录不存在」与「瞬时 IO 错误」：listDir 在 Tauri/Capacitor 对
    // 不存在目录抛错、瞬时错误也抛错，混为一谈会把重建做成误覆盖旁路（kimi 复审 R4）。
    // statEntry 判别「目录不存在」与「瞬时 IO 错误」（kimi 复审 R4）：瞬时错误向外抛——
    // ensureIndex 整笔中止不写索引（留现场下次重试），绝不写空索引埋掉会话。
    let names: string[] = [];
    const dirStat = await this.adapter.statEntry(this.sessionsDir(contextPath));
    if (dirStat === "directory") {
      names = await this.adapter.listDir(this.sessionsDir(contextPath)); // 目录存在时抛错 = 瞬时错误，向外抛
    }
    for (const name of names) {
      const match = /^([A-Za-z0-9_-]+)\.yaml$/.exec(name);
      if (!match) continue;
      const id = match[1];
      if (id === "index") continue;
      try {
        const file = await this.readChatFile(this.sessionPath(contextPath, id), contextPath);
        // SettingsChatMessageEnvelope 是 role/content 形状（无 kind 字段，kimi 交叉验证 2026-09-14）
        const hasUserMessage = file.messages.some((m) => m.role === "user");
        index.sessions.push({
          id,
          title: deriveSettingsChatTitle(file.messages, UNTITLED_FALLBACK),
          ...(hasUserMessage ? {} : { title_auto: true }),
          created_at: file.created_at,
          updated_at: file.updated_at,
          message_count: file.messages.length,
        });
      } catch (err) {
        warnAlways("settings_chat", `rebuild index: skip unreadable session file ${name}`, {
          error: (err as Error).message,
        });
      }
    }
    return index;
  }

  private async ensureIndex(contextPath: string): Promise<void> {
    const indexPath = this.indexPath(contextPath);
    await withWriteLock(indexPath, async () => {
      const state = await this.indexFileState(contextPath);
      if (state === "ok") return;
      if (state === "corrupt") {
        warnAlways(
          "settings_chat",
          `settings chat session index corrupted for ${contextPath}; rebuilding from session files`,
        );
        await this.writeIndexLocked(contextPath, await this.rebuildIndexFromSessionFiles(contextPath));
        return;
      }
      await this.writeIndexLocked(contextPath, createChatSessionIndex());
    });
  }

  /**
   * 同步索引元数据（updated_at / message_count / 自动标题）。条目不存在时不补建
   * （缺条目 = 会话刚被并发删除，绝不在索引里复活它——对抗审 2026-09-14 major）；
   * 正常创建路径一律走 createSession 注册。只在索引锁内读写，不碰会话文件锁。
   */
  private async touchIndexMeta(
    contextPath: string,
    sessionId: string,
    messages: SettingsChatMessageEnvelope[],
  ): Promise<void> {
    const indexPath = this.indexPath(contextPath);
    await withWriteLock(indexPath, async () => {
      const index = (await this.readIndex(contextPath)) ?? createChatSessionIndex();
      const now = nowUtc();
      const entry = index.sessions.find((s) => s.id === sessionId);
      if (!entry) {
        warnAlways("settings_chat", `touchIndexMeta: session ${sessionId} not in index (deleted?); skip index update`);
        return;
      }
      entry.updated_at = now;
      entry.message_count = messages.length;
      if (entry.title_auto) {
        const derived = deriveSettingsChatTitle(messages, "");
        if (derived) {
          entry.title = derived;
          delete entry.title_auto;
        }
      }
      await this.writeIndexLocked(contextPath, index);
    });
  }

  // -------------------------------------------------------------------------
  // 会话面
  // -------------------------------------------------------------------------

  async listSessions(contextPath: string): Promise<ChatSessionMeta[]> {
    await this.ensureIndex(contextPath);
    const index = await this.readIndex(contextPath);
    const sessions = index?.sessions ?? [];
    return [...sessions].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  }

  async createSession(contextPath: string, title?: string): Promise<ChatSessionMeta> {
    await this.ensureIndex(contextPath);
    const trimmed = title?.trim() ?? "";
    const now = nowUtc();
    const meta: ChatSessionMeta = {
      id: generateChatSessionId(),
      title: (trimmed || UNTITLED_FALLBACK).slice(0, CHAT_SESSION_TITLE_MAX),
      ...(trimmed ? {} : { title_auto: true }),
      created_at: now,
      updated_at: now,
      message_count: 0,
    };
    const indexPath = this.indexPath(contextPath);
    await withWriteLock(indexPath, async () => {
      const index = (await this.readIndex(contextPath)) ?? createChatSessionIndex();
      index.sessions.push(meta);
      await this.writeIndexLocked(contextPath, index);
    });
    return meta;
  }

  async renameSession(contextPath: string, sessionId: string, title: string): Promise<void> {
    await this.ensureIndex(contextPath);
    const trimmed = title.trim().slice(0, CHAT_SESSION_TITLE_MAX);
    if (!trimmed) return;
    const indexPath = this.indexPath(contextPath);
    await withWriteLock(indexPath, async () => {
      const index = await this.readIndex(contextPath);
      if (!index) return;
      const entry = index.sessions.find((s) => s.id === sessionId);
      if (!entry) return; // 与并发 delete 撞车 → 静默幂等
      entry.title = trimmed;
      delete entry.title_auto;
      await this.writeIndexLocked(contextPath, index);
    });
  }

  async deleteSession(contextPath: string, sessionId: string): Promise<void> {
    await this.ensureIndex(contextPath);
    const indexPath = this.indexPath(contextPath);
    await withWriteLock(indexPath, async () => {
      const index = await this.readIndex(contextPath);
      if (!index) return;
      const next = index.sessions.filter((s) => s.id !== sessionId);
      if (next.length === index.sessions.length) return; // 不存在 → 幂等
      index.sessions = next;
      // 记墓碑（对称 simple_chat；防重建/并发路径复活已删会话）
      const retired = new Set(index.retired_session_ids ?? []);
      retired.add(sessionId);
      index.retired_session_ids = [...retired];
      await this.writeIndexLocked(contextPath, index);
    });
    // 删文件持会话锁（kimi R8 minor）：与 in-flight saveSession 的写互斥，防 orphan 文件
    // 在索引重建时被当存活会话注册回来。三端 deleteFile 漂移，「删除即达期望态」自行兜底。
    try {
      await withWriteLock(this.sessionPath(contextPath, sessionId), async () => {
        await this.adapter.deleteFile(this.sessionPath(contextPath, sessionId));
      });
    } catch {
      // 文件本就不存在或删除失败：索引已除名，残留文件不再被引用
    }
  }

  async getSession(contextPath: string, sessionId: string): Promise<SettingsChatFile> {
    await this.ensureIndex(contextPath);
    return this.readChatFile(this.sessionPath(contextPath, sessionId), contextPath);
  }

  /**
   * 写前闸门：索引里不存在该会话（= 已被并发删除）时整笔写丢弃，防
   * save-after-delete 复活已删会话（对抗审 2026-09-14 major）。
   */
  private async shouldSkipWrite(contextPath: string, sessionId: string): Promise<boolean> {
    const index = await this.readIndex(contextPath);
    if (!index) return false; // 索引自身异常时不动拦（ensureIndex 已尽力）
    if (index.sessions.some((s) => s.id === sessionId)) return false;
    warnAlways("settings_chat", `skip write: session ${sessionId} not in index (deleted or never registered)`);
    return true;
  }

  async saveSession(contextPath: string, sessionId: string, messages: SettingsChatMessageEnvelope[]): Promise<void> {
    await this.ensureIndex(contextPath);
    // 先过 sessionPath 的 id 校验（非法 id 必须抛错，不能被跳过闸门静默吞掉）
    const path = this.sessionPath(contextPath, sessionId);
    // 闸门收进会话锁内（kimi R9 minor 残余 TOCTOU），与 deleteSession 的持锁删文件互斥
    await withWriteLock(path, async () => {
      if (await this.shouldSkipWrite(contextPath, sessionId)) return;
      await this.writeChatFileLocked(path, contextPath, messages);
    });
    await this.touchIndexMeta(contextPath, sessionId, messages);
  }

  async updateSession(
    contextPath: string,
    sessionId: string,
    updater: (messages: SettingsChatMessageEnvelope[]) => SettingsChatMessageEnvelope[],
  ): Promise<void> {
    await this.ensureIndex(contextPath);
    // 先过 sessionPath 的 id 校验（非法 id 必须抛错，不能被跳过闸门静默吞掉）
    const path = this.sessionPath(contextPath, sessionId);
    let applied: SettingsChatMessageEnvelope[] = [];
    await withWriteLock(path, async () => {
      if (await this.shouldSkipWrite(contextPath, sessionId)) return;
      // 以磁盘现状为基底，避免调用方拿内存快照整体覆盖时丢掉别处刚写入的消息。
      const file = await this.readChatFile(path, contextPath);
      applied = updater(file.messages);
      await this.writeChatFileLocked(path, contextPath, applied);
    });
    await this.touchIndexMeta(contextPath, sessionId, applied);
  }
}
