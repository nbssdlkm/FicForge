// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** SimpleChatRepository 抽象接口（FicForge Lite C2 chat 持久化）。 */

import type { ChatSessionMeta, SimpleChatFile, SimpleChatMessageEnvelope } from "../../domain/simple_chat.js";

export interface SimpleChatRepository {
  // ---------- legacy 单会话兼容面 ----------
  // 以下四个方法在实现层委托到 default 会话（首次访问自动迁移 simple-chat.yaml）。
  // 存量调用方（UI 防抖 save / 钉 accepted 标记）零改动继续工作。

  /**
   * 读取 AU 的 simple-chat.yaml；不存在返回空白 SimpleChatFile（au_path 字段已填）。
   * 损坏 / 不可读时也返回空白文件，错误吞掉（chat 历史是体验性数据，不应阻塞 panel 加载）。
   */
  get(au_id: string): Promise<SimpleChatFile>;

  /**
   * 全量替换写入（messages 数组）。updated_at 自动刷新；created_at 仅在新建时设置。
   * 用 withWriteLock 串行化同 AU 的并发 save，防止两次 append 紧挨着 setTimeout
   * fire 时把第一份 partial state 覆盖。
   */
  save(au_id: string, messages: SimpleChatMessageEnvelope[]): Promise<void>;

  /**
   * 锁内 read-modify-write：以磁盘当前内容为基底应用 updater 后写回。
   * 供「不依赖 UI 组件存活」的状态回写使用（如接受草稿后钉 accepted 标记）——
   * UI 侧防抖 save 走内存快照，组件卸载后快照即失效；这里保证关键终态仍能落盘，
   * 且不会覆盖 updater 之外的并发变更（读写同锁）。
   */
  update(au_id: string, updater: (messages: SimpleChatMessageEnvelope[]) => SimpleChatMessageEnvelope[]): Promise<void>;

  /** 清空对话历史（删除文件 / 写空 messages）。 */
  clear(au_id: string): Promise<void>;

  // ---------- 多会话面（chat-sessions 底座） ----------

  /** 列出会话索引（首次调用自动迁移 legacy 单文件）。按 updated_at 倒序。 */
  listSessions(au_id: string): Promise<ChatSessionMeta[]>;

  /**
   * 新建会话（空消息体）。title 缺省时落 title_auto 占位，首次落盘含用户消息时
   * 仓储自动改写标题（deriveChatSessionTitle）。返回新建条目。
   */
  createSession(au_id: string, title?: string): Promise<ChatSessionMeta>;

  /** 重命名（title 截断到 CHAT_SESSION_TITLE_MAX；改名后不再参与自动起名）。 */
  renameSession(au_id: string, session_id: string, title: string): Promise<void>;

  /** 删除会话（索引条目 + 会话文件）。不存在的 id 静默幂等。 */
  deleteSession(au_id: string, session_id: string): Promise<void>;

  /** 读指定会话；不存在返回空白 SimpleChatFile（同 get 的宽容语义）。 */
  getSession(au_id: string, session_id: string): Promise<SimpleChatFile>;

  /** 全量替换写指定会话；同步索引的 updated_at / message_count / 自动标题。 */
  saveSession(au_id: string, session_id: string, messages: SimpleChatMessageEnvelope[]): Promise<void>;

  /** 指定会话的锁内 read-modify-write（同 update 语义）。 */
  updateSession(
    au_id: string,
    session_id: string,
    updater: (messages: SimpleChatMessageEnvelope[]) => SimpleChatMessageEnvelope[],
  ): Promise<void>;
}
