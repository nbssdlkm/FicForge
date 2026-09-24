// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FileSimpleChatRepository — AU 对话持久化。
 *
 * 多会话底座（chat-sessions）：
 * - `{au_path}/.well-known/chat-sessions/index.yaml` 会话索引
 * - `{au_path}/.well-known/chat-sessions/{session_id}.yaml` 每会话一份消息
 * - legacy 单文件 `{au_path}/.well-known/simple-chat.yaml` 首次访问自动迁移为
 *   default 会话（老文件保留不删，降级回旧版 App 仍能读到）；
 *   legacy get/save/update/clear 四个方法委托到 default 会话，存量调用方零改动。
 *
 * 设计要点：
 * - 损坏/不存在均返回空白 SimpleChatFile（chat 是体验数据，不阻塞 panel）
 * - withWriteLock 串行化同路径并发写（会话文件锁 + 索引锁分离；锁顺序恒为
 *   「会话文件锁 → 索引锁」，touchIndexMeta 只在会话文件锁外取索引锁，防死锁）
 * - YAML lineWidth=-1 让长 message content 不被换行，方便 grep / 人工编辑
 */

import * as yaml from "js-yaml";
import type { PlatformAdapter } from "../../platform/adapter.js";
import type {
  ChatSessionIndex,
  ChatSessionMeta,
  SimpleChatFile,
  SimpleChatMessageEnvelope,
} from "../../domain/simple_chat.js";
import {
  CHAT_SESSION_INDEX_VERSION,
  CHAT_SESSION_TITLE_MAX,
  createChatSessionIndex,
  createSimpleChatFile,
  DEFAULT_CHAT_SESSION_ID,
  deriveChatSessionTitle,
  SIMPLE_CHAT_VERSION,
} from "../../domain/simple_chat.js";
import type { SimpleChatRepository } from "../interfaces/simple_chat.js";
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

const CHAT_FILE_NAME = "simple-chat.yaml";
const WELL_KNOWN_DIR = ".well-known";
const SESSIONS_DIR_NAME = "chat-sessions";
const INDEX_FILE_NAME = "index.yaml";

/**
 * 自动起名前的语言中立占位（title_auto=true 时会被首条用户消息改写；
 * UI 新建会话会传本地化标题，此值只出现在迁移/直调仓储的路径）。
 */
const UNTITLED_FALLBACK = "Session";

/** 会话 id 白名单（防路径穿越；id 由仓储生成，正常必过）。 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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

  // -------------------------------------------------------------------------
  // 路径
  // -------------------------------------------------------------------------

  private chatPath(au_id: string): string {
    validateBasePath(au_id, "au_id");
    return joinPath(au_id, WELL_KNOWN_DIR, CHAT_FILE_NAME);
  }

  private sessionsDir(au_id: string): string {
    validateBasePath(au_id, "au_id");
    return joinPath(au_id, WELL_KNOWN_DIR, SESSIONS_DIR_NAME);
  }

  private indexPath(au_id: string): string {
    return joinPath(this.sessionsDir(au_id), INDEX_FILE_NAME);
  }

  private sessionPath(au_id: string, session_id: string): string {
    if (!SESSION_ID_PATTERN.test(session_id)) {
      throw new Error(`invalid chat session id: ${session_id}`);
    }
    return joinPath(this.sessionsDir(au_id), `${session_id}.yaml`);
  }

  // -------------------------------------------------------------------------
  // 会话文件读写（legacy 单文件与多会话文件共用的宽容读 / 原子写）
  // -------------------------------------------------------------------------

  /** 宽容读取一份 chat 文件；不存在 / 损坏 / 形状非法均回退空白（au_path 字段已填）。 */
  private async readChatFile(path: string, fallbackAuPath: string): Promise<SimpleChatFile> {
    let exists = false;
    try {
      exists = await this.adapter.exists(path);
    } catch {
      return createSimpleChatFile({ au_path: fallbackAuPath });
    }
    if (!exists) {
      return createSimpleChatFile({ au_path: fallbackAuPath });
    }

    let text: string;
    try {
      text = await this.adapter.readFile(path);
    } catch {
      return createSimpleChatFile({ au_path: fallbackAuPath });
    }

    let raw: unknown;
    try {
      raw = yaml.load(text);
    } catch (err) {
      // YAML 损坏时降级到空文件，但日志要可见 —— 否则用户外部编辑器破坏格式后
      // 对话历史"静默消失"，无任何提示（v4 盲审 P1-6）。
      warnAlways("simple_chat", `yaml.load failed for ${fallbackAuPath}; serving empty chat`, {
        error: (err as Error).message,
      });
      return createSimpleChatFile({ au_path: fallbackAuPath });
    }
    if (!raw || typeof raw !== "object") {
      warnAlways("simple_chat", `non-object root in chat.yaml for ${fallbackAuPath}; serving empty chat`);
      return createSimpleChatFile({ au_path: fallbackAuPath });
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
      au_path: typeof obj.au_path === "string" ? obj.au_path : fallbackAuPath,
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

  /** 锁内原子写一份 chat 文件（created_at 保留现有值）。调用方不得再嵌套本路径锁。 */
  private async writeChatFileLocked(path: string, au_id: string, messages: SimpleChatMessageEnvelope[]): Promise<void> {
    const createdAt = (await this.readCreatedAt(path)) ?? nowUtc();
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
  }

  // -------------------------------------------------------------------------
  // 索引读写
  // -------------------------------------------------------------------------

  /** 宽容读索引；不存在 / 损坏 / 形状非法返回 null（交由 ensureIndex 重建）。 */
  private async readIndex(au_id: string): Promise<ChatSessionIndex | null> {
    const path = this.indexPath(au_id);
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
      warnAlways("simple_chat", `yaml.load failed for chat session index of ${au_id}; rebuilding`, {
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
      ...(obj.migrated_from_legacy === true ? { migrated_from_legacy: true } : {}),
      ...(Array.isArray(obj.retired_session_ids)
        ? { retired_session_ids: obj.retired_session_ids.filter((v): v is string => typeof v === "string") }
        : {}),
    };
  }

  /** 锁内写索引（调用方须已持 indexPath 锁）。 */
  private async writeIndexLocked(au_id: string, index: ChatSessionIndex): Promise<void> {
    const path = this.indexPath(au_id);
    const content = dumpYaml(objToPlain(index));
    await this.adapter.mkdir(this.sessionsDir(au_id));
    await atomicWrite(this.adapter, path, content);
  }

  /**
   * 索引文件状态：missing（从未创建）/ ok / corrupt（存在但读不出）。
   * ensureIndex 靠它区分「新建」与「损坏重建」——后者必须抢救会话文件，
   * 不能写空索引把多会话列表埋掉（对抗审 2026-09-14 major）。
   */
  private async indexFileState(au_id: string): Promise<"missing" | "ok" | "corrupt"> {
    try {
      if (!(await this.adapter.exists(this.indexPath(au_id)))) return "missing";
    } catch {
      return "missing";
    }
    return (await this.readIndex(au_id)) ? "ok" : "corrupt";
  }

  /**
   * 索引损坏时从会话文件抢救重建：扫 sessions 目录逐份宽容读，恢复
   * id / 自动标题 / 消息数 / 时间戳。读不出的文件跳过（不拖垮其余会话）。
   */
  private async rebuildIndexFromSessionFiles(au_id: string): Promise<ChatSessionIndex> {
    const index = createChatSessionIndex();
    // statEntry 判别「目录不存在」与「瞬时 IO 错误」：listDir 在 Tauri/Capacitor 对
    // 不存在目录抛错、瞬时错误也抛错，混为一谈会把重建做成误覆盖旁路（kimi 复审 R4）。
    // statEntry 判别「目录不存在」与「瞬时 IO 错误」（kimi 复审 R4）：瞬时错误向外抛——
    // ensureIndex 整笔中止不写索引（留现场下次重试），绝不写空索引埋掉会话。
    let names: string[] = [];
    const dirStat = await this.adapter.statEntry(this.sessionsDir(au_id));
    if (dirStat === "directory") {
      names = await this.adapter.listDir(this.sessionsDir(au_id)); // 目录存在时抛错 = 瞬时错误，向外抛
    }
    for (const name of names) {
      const match = /^([A-Za-z0-9_-]+)\.yaml$/.exec(name);
      if (!match) continue;
      const id = match[1];
      if (id === "index") continue;
      try {
        const file = await this.readChatFile(this.sessionPath(au_id, id), au_id);
        const hasUserMessage = file.messages.some((m) => m.kind === "user");
        index.sessions.push({
          id,
          title: deriveChatSessionTitle(file.messages, UNTITLED_FALLBACK),
          ...(hasUserMessage ? {} : { title_auto: true }),
          created_at: file.created_at,
          updated_at: file.updated_at,
          message_count: file.messages.length,
        });
      } catch (err) {
        warnAlways("simple_chat", `rebuild index: skip unreadable session file ${name}`, {
          error: (err as Error).message,
        });
      }
    }
    return index;
  }

  /**
   * 确保索引存在（幂等）。三分支：
   * - ok：不动
   * - corrupt：扫会话文件抢救重建（不写空索引埋掉会话列表）
   * - missing：建空索引；若 legacy simple-chat.yaml 存在则迁移为 default 会话
   *   （消息原样搬入 default.yaml；老文件保留不删，降级兼容）。
   */
  private async ensureIndex(au_id: string): Promise<void> {
    const indexPath = this.indexPath(au_id);
    await withWriteLock(indexPath, async () => {
      const state = await this.indexFileState(au_id);
      if (state === "ok") return;
      if (state === "corrupt") {
        warnAlways(
          "simple_chat",
          `chat session index corrupted for ${au_id}; rebuilding from session files (retired tombstones lost)`,
        );
        await this.writeIndexLocked(au_id, await this.rebuildIndexFromSessionFiles(au_id));
        return;
      }

      // kimi 交叉验证 2026-09-14 major：index 丢失但会话文件还在（崩溃窗口/手动清理）
      // 时绝不能走 legacy 迁移——那会把 legacy 旧消息覆盖已更新的 default.yaml。
      // 有会话文件 = 抢救重建；完全没有 = 才考虑 legacy 迁移。
      // statEntry 判别「目录不存在」与「瞬时 IO 错误」（kimi 复审 R4）：瞬时错误向外抛，
      // ensureIndex 整笔中止（不写索引不迁移，留现场下次重试），防把迁移做成覆盖旁路。
      const sessionsDirStat = await this.adapter.statEntry(this.sessionsDir(au_id));
      if (sessionsDirStat === "directory") {
        // kimi R8 major：目录存在（哪怕已被 deleteSession 清空）= 会话系统初始化过，
        // 一律重建而不走 legacy 迁移——否则「删 default → 索引丢失 → legacy 文件保留」
        // 会把用户已显式删除的会话连同旧消息复活。墓碑随索引丢失是已知限制（warn 留痕）。
        warnAlways(
          "simple_chat",
          `chat session index missing for ${au_id} but sessions dir exists; rebuilding (retired tombstones lost)`,
        );
        await this.writeIndexLocked(au_id, await this.rebuildIndexFromSessionFiles(au_id));
        return;
      }
      // 目录也不存在 = 真·新鲜 AU，才允许 legacy 迁移。

      const index = createChatSessionIndex();
      let legacyExists = false;
      try {
        legacyExists = await this.adapter.exists(this.chatPath(au_id));
      } catch {
        legacyExists = false;
      }
      if (legacyExists) {
        const legacyFile = await this.readChatFile(this.chatPath(au_id), au_id);
        const hasUserMessage = legacyFile.messages.some((m) => m.kind === "user");
        const meta: ChatSessionMeta = {
          id: DEFAULT_CHAT_SESSION_ID,
          title: deriveChatSessionTitle(legacyFile.messages, UNTITLED_FALLBACK),
          ...(hasUserMessage ? {} : { title_auto: true }),
          created_at: legacyFile.created_at,
          updated_at: legacyFile.updated_at,
          message_count: legacyFile.messages.length,
        };
        index.sessions.push(meta);
        index.migrated_from_legacy = true;
        // 写 default 会话文件（与索引锁不同路径，无嵌套锁）；created_at/updated_at
        // 保留 legacy 原值（writeChatFileLocked 会刷 updated_at，迁移场景要原样搬）。
        // 保留 legacy 原时间戳（原子写不刷新）。
        const sessionFile: SimpleChatFile = {
          version: SIMPLE_CHAT_VERSION,
          au_path: au_id,
          created_at: legacyFile.created_at,
          updated_at: legacyFile.updated_at,
          messages: legacyFile.messages,
        };
        // 非破坏性（复审 R5/R6 major）：迁移全程持 default 会话文件锁（与 saveSession 的
        // 会话锁互斥，堵「索引丢失窗口期迁移写与并发 save 交叉」）；探测不吞错——
        // exists 抛错 = 瞬时故障，整笔中止留现场下次重试（已知平台限制：Capacitor
        // adapter 的 exists 内部吞错返 false，三探针全跪的叠加窗口属残余风险，见派工单）。
        const defaultPath = this.sessionPath(au_id, DEFAULT_CHAT_SESSION_ID);
        await this.adapter.mkdir(this.sessionsDir(au_id));
        await withWriteLock(defaultPath, async () => {
          if (await this.adapter.exists(defaultPath)) {
            warnAlways("simple_chat", `legacy migration: ${defaultPath} already exists; keep it and register as-is`);
            const existingFile = await this.readChatFile(defaultPath, au_id);
            if (existingFile.messages.length > 0) {
              // 现存文件可读：按现状注册（R6 minor：损坏文件宽容读出空壳时不采纳其
              // 时间戳/零消息数，免得把有历史的会话在列表里伪装成「刚创建的空会话」）
              meta.title = deriveChatSessionTitle(existingFile.messages, meta.title);
              if (existingFile.messages.some((m) => m.kind === "user")) delete meta.title_auto;
              meta.created_at = existingFile.created_at;
              meta.updated_at = existingFile.updated_at;
              meta.message_count = existingFile.messages.length;
            } else {
              warnAlways(
                "simple_chat",
                `legacy migration: ${defaultPath} exists but unreadable/empty; register with legacy meta`,
              );
            }
            return;
          }
          await atomicWrite(this.adapter, defaultPath, dumpYaml(objToPlain(sessionFile)));
        });
      }
      await this.writeIndexLocked(au_id, index);
    });
  }

  /**
   * 同步索引元数据（updated_at / message_count / 自动标题）。条目不存在时 warn+return
   * 绝不补建（缺条目=会话刚被并发删除，复活它是数据事故；正常写路径条目必已注册，
   * legacy default 直写由 ensureDefaultRegistered 先注册）。只在索引锁内读写。
   */
  private async touchIndexMeta(
    au_id: string,
    session_id: string,
    messages: SimpleChatMessageEnvelope[],
  ): Promise<void> {
    const indexPath = this.indexPath(au_id);
    await withWriteLock(indexPath, async () => {
      const index = (await this.readIndex(au_id)) ?? createChatSessionIndex();
      const now = nowUtc();
      const entry = index.sessions.find((s) => s.id === session_id);
      if (!entry) {
        // 缺条目 = 会话刚被并发删除（shouldSkipWrite 之后 delete 落地）——绝不在
        // 索引里复活它（对抗审 2026-09-14 major）。正常写路径条目必已注册。
        warnAlways("simple_chat", `touchIndexMeta: session ${session_id} not in index (deleted?); skip index update`);
        return;
      }
      entry.updated_at = now;
      entry.message_count = messages.length;
      if (entry.title_auto) {
        const derived = deriveChatSessionTitle(messages, "");
        if (derived) {
          entry.title = derived;
          delete entry.title_auto;
        }
      }
      await this.writeIndexLocked(au_id, index);
    });
  }

  // -------------------------------------------------------------------------
  // legacy 兼容面（委托 default 会话）
  // -------------------------------------------------------------------------

  async get(au_id: string): Promise<SimpleChatFile> {
    return this.getSession(au_id, DEFAULT_CHAT_SESSION_ID);
  }

  /**
   * legacy 直写 default 前显式注册条目（shouldSkipWrite 对所有 id 生效后，老调用方
   * 在索引建立前直写 default 的合法路径靠它保住——复审 2026-09-14）。
   */
  private async ensureDefaultRegistered(au_id: string): Promise<void> {
    await this.ensureIndex(au_id);
    const indexPath = this.indexPath(au_id);
    await withWriteLock(indexPath, async () => {
      const index = (await this.readIndex(au_id)) ?? createChatSessionIndex();
      if (index.sessions.some((s) => s.id === DEFAULT_CHAT_SESSION_ID)) return;
      if (index.retired_session_ids?.includes(DEFAULT_CHAT_SESSION_ID)) {
        // default 被显式删除过：legacy 直写不复活它（复审 2026-09-14 R2 major）
        warnAlways("simple_chat", "legacy save skipped: default session was explicitly deleted");
        return;
      }
      const now = nowUtc();
      index.sessions.push({
        id: DEFAULT_CHAT_SESSION_ID,
        title: UNTITLED_FALLBACK,
        title_auto: true,
        created_at: now,
        updated_at: now,
        message_count: 0,
      });
      await this.writeIndexLocked(au_id, index);
    });
  }

  async save(au_id: string, messages: SimpleChatMessageEnvelope[]): Promise<void> {
    await this.ensureDefaultRegistered(au_id);
    return this.saveSession(au_id, DEFAULT_CHAT_SESSION_ID, messages);
  }

  async update(
    au_id: string,
    updater: (messages: SimpleChatMessageEnvelope[]) => SimpleChatMessageEnvelope[],
  ): Promise<void> {
    await this.ensureDefaultRegistered(au_id);
    return this.updateSession(au_id, DEFAULT_CHAT_SESSION_ID, updater);
  }

  async clear(au_id: string): Promise<void> {
    await this.ensureDefaultRegistered(au_id);
    return this.saveSession(au_id, DEFAULT_CHAT_SESSION_ID, []);
  }

  // -------------------------------------------------------------------------
  // 多会话面
  // -------------------------------------------------------------------------

  async listSessions(au_id: string): Promise<ChatSessionMeta[]> {
    await this.ensureIndex(au_id);
    const index = await this.readIndex(au_id);
    const sessions = index?.sessions ?? [];
    return [...sessions].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  }

  async createSession(au_id: string, title?: string): Promise<ChatSessionMeta> {
    await this.ensureIndex(au_id);
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
    const indexPath = this.indexPath(au_id);
    await withWriteLock(indexPath, async () => {
      const index = (await this.readIndex(au_id)) ?? createChatSessionIndex();
      index.sessions.push(meta);
      await this.writeIndexLocked(au_id, index);
    });
    return meta;
  }

  async renameSession(au_id: string, session_id: string, title: string): Promise<void> {
    await this.ensureIndex(au_id);
    const trimmed = title.trim().slice(0, CHAT_SESSION_TITLE_MAX);
    if (!trimmed) return;
    const indexPath = this.indexPath(au_id);
    await withWriteLock(indexPath, async () => {
      const index = await this.readIndex(au_id);
      if (!index) return;
      const entry = index.sessions.find((s) => s.id === session_id);
      if (!entry) return; // 与并发 delete 撞车 → 静默幂等
      entry.title = trimmed;
      delete entry.title_auto;
      await this.writeIndexLocked(au_id, index);
    });
  }

  async deleteSession(au_id: string, session_id: string): Promise<void> {
    await this.ensureIndex(au_id);
    const indexPath = this.indexPath(au_id);
    await withWriteLock(indexPath, async () => {
      const index = await this.readIndex(au_id);
      if (!index) return;
      const next = index.sessions.filter((s) => s.id !== session_id);
      if (next.length === index.sessions.length) return; // 不存在 → 幂等
      index.sessions = next;
      // 记墓碑：legacy save() 等注册路径不得复活已删会话（复审 R2 major）
      const retired = new Set(index.retired_session_ids ?? []);
      retired.add(session_id);
      index.retired_session_ids = [...retired];
      await this.writeIndexLocked(au_id, index);
    });
    // 删文件持会话锁（kimi R8 minor）：与 in-flight saveSession 的写互斥——否则删除先完成、
    // 慢半拍的写后落地会留下 orphan 文件，索引损坏重建时会把它当存活会话注册回来。
    // 三端 deleteFile 对不存在路径行为漂移（Tauri 抛错 / mock 幂等），「删除即达期望态」自行兜底。
    try {
      await withWriteLock(this.sessionPath(au_id, session_id), async () => {
        await this.adapter.deleteFile(this.sessionPath(au_id, session_id));
      });
    } catch {
      // 文件本就不存在或删除失败：索引已除名，残留文件不再被引用
    }
  }

  async getSession(au_id: string, session_id: string): Promise<SimpleChatFile> {
    await this.ensureIndex(au_id);
    return this.readChatFile(this.sessionPath(au_id, session_id), au_id);
  }

  /**
   * 写前闸门：索引里不存在该会话（= 已被并发删除）时整笔写丢弃——否则
   * save-after-delete 会把已删会话的文件与索引项双双复活（对抗审 2026-09-14 major）。
   * 对所有 id 生效、无 default 例外（复审 2026-09-14：default 豁免在「删除 default 后
   * 慢半拍的防抖 save」场景同样构成复活后门）；legacy 直写 default 的合法路径改由
   * save()/update() 委托前 ensureDefaultRegistered 显式注册。
   */
  private async shouldSkipWrite(au_id: string, session_id: string): Promise<boolean> {
    const index = await this.readIndex(au_id);
    if (!index) return false; // 索引自身异常时不动拦（ensureIndex 已尽力）
    if (index.sessions.some((s) => s.id === session_id)) return false;
    warnAlways("simple_chat", `skip write: session ${session_id} not in index (deleted or never registered)`);
    return true;
  }

  async saveSession(au_id: string, session_id: string, messages: SimpleChatMessageEnvelope[]): Promise<void> {
    await this.ensureIndex(au_id);
    // 先过 sessionPath 的 id 校验（非法 id 必须抛错，不能被跳过闸门静默吞掉）
    const path = this.sessionPath(au_id, session_id);
    // 闸门收进会话锁内（kimi R9 minor 残余 TOCTOU）：deleteSession 删文件也持会话锁，
    // 检查→写入原子化——并发删除落地后本轮写必然看到索引无条目而丢弃，不留 orphan。
    await withWriteLock(path, async () => {
      if (await this.shouldSkipWrite(au_id, session_id)) return;
      await this.writeChatFileLocked(path, au_id, messages);
    });
    await this.touchIndexMeta(au_id, session_id, messages);
  }

  async updateSession(
    au_id: string,
    session_id: string,
    updater: (messages: SimpleChatMessageEnvelope[]) => SimpleChatMessageEnvelope[],
  ): Promise<void> {
    await this.ensureIndex(au_id);
    // 先过 sessionPath 的 id 校验（非法 id 必须抛错，不能被跳过闸门静默吞掉）
    const path = this.sessionPath(au_id, session_id);
    let applied: SimpleChatMessageEnvelope[] = [];
    await withWriteLock(path, async () => {
      if (await this.shouldSkipWrite(au_id, session_id)) return;
      // get() 不取锁，可安全在锁内复用；以磁盘现状为基底，避免调用方拿内存快照
      // 整体覆盖时丢掉别处刚写入的消息（接受标记 vs 防抖 save 的并发场景）。
      const file = await this.readChatFile(path, au_id);
      applied = updater(file.messages);
      await this.writeChatFileLocked(path, au_id, applied);
    });
    await this.touchIndexMeta(au_id, session_id, applied);
  }
}
