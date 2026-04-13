// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 后台任务系统 — 类型定义。
 *
 * 状态机：pending → running ⇄ paused → completed / failed / cancelled
 *                    ↓
 *               interrupted（切后台 / 崩溃）→ resume 恢复为 running
 */

// ---------------------------------------------------------------------------
// 任务状态
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";

// ---------------------------------------------------------------------------
// 任务事件（UI 订阅用）
// ---------------------------------------------------------------------------

export type TaskEvent =
  | { type: "progress"; current: number; total: number; message?: string }
  | { type: "chunk_done"; chunkId: string; result?: unknown }
  | { type: "paused"; reason: string }
  | { type: "completed"; result: unknown }
  | { type: "failed"; error: string }
  | { type: "cancelled" };

// ---------------------------------------------------------------------------
// 任务定义接口（每种任务实现此接口）
// ---------------------------------------------------------------------------

export interface TaskDefinition<TParams = unknown, TResult = unknown> {
  /** 任务类型标识，如 "facts_extraction"、"index_rebuild" */
  type: string;
  /** 任务参数 */
  params: TParams;
  /** 执行入口，返回 AsyncGenerator 逐步 yield 事件 */
  execute(ctx: TaskContext): AsyncGenerator<TaskEvent, TResult>;
  /** 从断点恢复（可选），不实现则从头重跑 */
  resume?(ctx: TaskContext, checkpoint: TaskCheckpoint): AsyncGenerator<TaskEvent, TResult>;
}

// ---------------------------------------------------------------------------
// 执行上下文（TaskRunner 注入给每个任务）
// ---------------------------------------------------------------------------

export interface TaskContext {
  /** 取消信号，任务实现内部检查 signal.aborted */
  signal: AbortSignal;
  /** 写入断点数据（TaskRunner 按节制策略实际写盘） */
  saveCheckpoint(data: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// 断点数据（持久化到 {dataDir}/.ficforge/tasks/{taskId}.json）
// ---------------------------------------------------------------------------

export interface TaskCheckpoint {
  taskId: string;
  taskType: string;
  status: "running" | "paused" | "interrupted";
  params: unknown;
  progress: { current: number; total: number };
  data: unknown;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 运行中任务的内部表示
// ---------------------------------------------------------------------------

export interface TaskHandle {
  id: string;
  type: string;
  status: TaskStatus;
  progress: { current: number; total: number };
  error?: string;
  result?: unknown;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// TaskRunner 配置
// ---------------------------------------------------------------------------

export interface TaskRunnerOptions {
  /** visibilitychange 回调，用于移动端切后台检测 */
  onVisibilityChange?: (hidden: boolean, activeTaskCount: number) => void;
  /** 未来扩展：Android Foreground Service 等 */
  backgroundAdapter?: unknown;
}

// ---------------------------------------------------------------------------
// 事件监听器类型
// ---------------------------------------------------------------------------

export type TaskEventListener = (taskId: string, event: TaskEvent) => void;
export type TaskStatusListener = (taskId: string, status: TaskStatus, handle: TaskHandle) => void;
