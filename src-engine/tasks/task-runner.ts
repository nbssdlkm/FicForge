// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 后台任务系统 — 核心编排器。
 *
 * 职责：队列管理、并发控制（默认 1）、进度分发、取消、暂停/恢复、
 *       visibilitychange 检测（移动端切后台时写断点）。
 *
 * 设计原则：
 * - 主线程运行，不依赖 DOM
 * - 零新 npm 依赖
 * - TaskDefinition 通过 AsyncGenerator yield 事件，runner 统一消费
 */

import type {
  TaskDefinition,
  TaskContext,
  TaskCheckpoint,
  TaskEvent,
  TaskEventListener,
  TaskHandle,
  TaskRunnerOptions,
  TaskStatus,
  TaskStatusListener,
} from "./types.js";
import { TaskStore } from "./task-store.js";
import { now_utc } from "../repositories/implementations/file_utils.js";
import type { PlatformAdapter } from "../platform/index.js";

// ---------------------------------------------------------------------------
// Internal task entry
// ---------------------------------------------------------------------------

interface InternalTask {
  handle: TaskHandle;
  definition: TaskDefinition;
  abortController: AbortController;
  checkpoint?: TaskCheckpoint;
  /** 最近一次 checkpoint 的 data，用于 visibilitychange 写盘 */
  pendingCheckpointData?: unknown;
}

/** completed Map 上限，防止长会话内存泄漏 */
const MAX_COMPLETED = 50;

// ---------------------------------------------------------------------------
// TaskRunner
// ---------------------------------------------------------------------------

export class TaskRunner {
  private queue: InternalTask[] = [];
  private running: Map<string, InternalTask> = new Map();
  private completed: Map<string, TaskHandle> = new Map();
  private concurrency: number;
  private store: TaskStore;
  private options: TaskRunnerOptions;

  private eventListeners = new Set<TaskEventListener>();
  private statusListeners = new Set<TaskStatusListener>();

  private visibilityHandler: (() => void) | null = null;

  constructor(adapter: PlatformAdapter, dataDir: string, options?: TaskRunnerOptions) {
    this.concurrency = 1;
    this.store = new TaskStore(adapter, dataDir);
    this.options = options ?? {};
    this.setupVisibilityListener();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** 提交新任务，返回 taskId */
  submit(definition: TaskDefinition): string {
    const id = crypto.randomUUID();

    const handle: TaskHandle = {
      id,
      type: definition.type,
      status: "pending",
      progress: { current: 0, total: 0 },
      params: definition.params,
      createdAt: now_utc(),
    };

    const entry: InternalTask = {
      handle,
      definition,
      abortController: new AbortController(),
    };

    this.queue.push(entry);
    this.notifyStatus(id, "pending", handle);
    this.drain();
    return id;
  }

  /** 从断点恢复任务 */
  resume(checkpoint: TaskCheckpoint, definition: TaskDefinition): string {
    const id = checkpoint.taskId;
    const handle: TaskHandle = {
      id,
      type: checkpoint.taskType,
      status: "pending",
      progress: { ...checkpoint.progress },
      params: checkpoint.params,
      createdAt: now_utc(),
    };

    const entry: InternalTask = {
      handle,
      definition,
      abortController: new AbortController(),
      checkpoint,
    };

    this.queue.push(entry);
    this.notifyStatus(id, "pending", handle);
    this.drain();
    return id;
  }

  /** 取消任务 */
  cancel(taskId: string): void {
    const qIdx = this.queue.findIndex((t) => t.handle.id === taskId);
    if (qIdx >= 0) {
      const task = this.queue.splice(qIdx, 1)[0];
      task.handle.status = "cancelled";
      this.notifyStatus(taskId, "cancelled", task.handle);
      this.notifyEvent(taskId, { type: "cancelled" });
      void this.store.remove(taskId);
      return;
    }

    const running = this.running.get(taskId);
    if (running) {
      running.abortController.abort();
    }
  }

  /** 获取任务句柄（含已完成） */
  getTask(taskId: string): TaskHandle | undefined {
    const running = this.running.get(taskId);
    if (running) return running.handle;
    const queued = this.queue.find((t) => t.handle.id === taskId);
    if (queued) return queued.handle;
    return this.completed.get(taskId);
  }

  /** 获取所有活跃任务（pending + running） */
  getActiveTasks(): TaskHandle[] {
    const tasks: TaskHandle[] = [];
    for (const t of this.queue) tasks.push(t.handle);
    for (const t of this.running.values()) tasks.push(t.handle);
    return tasks;
  }

  /** 获取已完成/失败/取消的任务（最近 MAX_COMPLETED 个） */
  getCompletedTasks(): TaskHandle[] {
    return [...this.completed.values()];
  }

  /** 从已完成池中移除（UI 消费结果后调用，防止重复弹窗） */
  removeCompleted(taskId: string): void {
    this.completed.delete(taskId);
  }

  /** 检查是否有未完成的断点（app 启动时调用） */
  async getInterruptedTasks(): Promise<TaskCheckpoint[]> {
    return this.store.listInterrupted();
  }

  // -----------------------------------------------------------------------
  // Event subscription
  // -----------------------------------------------------------------------

  onEvent(listener: TaskEventListener): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  onStatusChange(listener: TaskStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  destroy(): void {
    for (const task of this.running.values()) {
      task.abortController.abort();
    }
    this.queue = [];
    this.removeVisibilityListener();
  }

  // -----------------------------------------------------------------------
  // Internal: scheduler
  // -----------------------------------------------------------------------

  private drain(): void {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running.set(task.handle.id, task);
      void this.executeTask(task);
    }
  }

  private async executeTask(task: InternalTask): Promise<void> {
    const { handle, definition, abortController } = task;

    handle.status = "running";
    this.notifyStatus(handle.id, "running", handle);

    const ctx: TaskContext = {
      signal: abortController.signal,
      saveCheckpoint: async (data: unknown) => {
        task.pendingCheckpointData = data;
        await this.store.save(this.buildCheckpoint(task, "running", data));
      },
    };

    try {
      const generator = task.checkpoint && definition.resume
        ? definition.resume(ctx, task.checkpoint)
        : definition.execute(ctx);

      let iterResult = await generator.next();
      while (!iterResult.done) {
        const event = iterResult.value;
        this.handleEvent(task, event);
        this.notifyEvent(handle.id, event);
        iterResult = await generator.next();
      }

      // Generator 正常返回 — 但可能是因为 signal.aborted 触发 break 退出
      if (abortController.signal.aborted) {
        handle.status = "cancelled";
        this.notifyEvent(handle.id, { type: "cancelled" });
        this.notifyStatus(handle.id, "cancelled", handle);
      } else {
        handle.status = "completed";
        handle.result = iterResult.value;
        this.notifyEvent(handle.id, { type: "completed", result: iterResult.value });
        this.notifyStatus(handle.id, "completed", handle);
      }
      await this.store.remove(handle.id);

    } catch (err) {
      if (abortController.signal.aborted) {
        handle.status = "cancelled";
        this.notifyEvent(handle.id, { type: "cancelled" });
        this.notifyStatus(handle.id, "cancelled", handle);
      } else {
        handle.status = "failed";
        handle.error = err instanceof Error ? err.message : String(err);
        this.notifyEvent(handle.id, { type: "failed", error: handle.error });
        this.notifyStatus(handle.id, "failed", handle);
      }
      await this.store.remove(handle.id);
    } finally {
      this.running.delete(handle.id);
      this.addCompleted(handle);
      this.drain();
    }
  }

  private handleEvent(task: InternalTask, event: TaskEvent): void {
    if (event.type === "progress") {
      task.handle.progress = { current: event.current, total: event.total };
    }
  }

  // -----------------------------------------------------------------------
  // Internal: checkpoint helper
  // -----------------------------------------------------------------------

  private buildCheckpoint(
    task: InternalTask,
    status: TaskCheckpoint["status"],
    data?: unknown,
  ): TaskCheckpoint {
    return {
      taskId: task.handle.id,
      taskType: task.definition.type,
      status,
      params: task.definition.params,
      progress: { ...task.handle.progress },
      data: data ?? task.pendingCheckpointData,
      updatedAt: now_utc(),
    };
  }

  // -----------------------------------------------------------------------
  // Internal: completed map with cap
  // -----------------------------------------------------------------------

  private addCompleted(handle: TaskHandle): void {
    this.completed.set(handle.id, handle);
    if (this.completed.size > MAX_COMPLETED) {
      // Map 按插入顺序迭代，删除最老的条目
      const oldest = this.completed.keys().next().value!;
      this.completed.delete(oldest);
    }
  }

  // -----------------------------------------------------------------------
  // Internal: notifications
  // -----------------------------------------------------------------------

  private notifyEvent(taskId: string, event: TaskEvent): void {
    for (const listener of this.eventListeners) {
      try { listener(taskId, event); } catch { /* listener error */ }
    }
  }

  private notifyStatus(taskId: string, status: TaskStatus, handle: TaskHandle): void {
    for (const listener of this.statusListeners) {
      try { listener(taskId, status, handle); } catch { /* listener error */ }
    }
  }

  // -----------------------------------------------------------------------
  // Internal: visibilitychange（移动端切后台检测）
  // -----------------------------------------------------------------------

  private setupVisibilityListener(): void {
    if (typeof document === "undefined") return;

    this.visibilityHandler = () => {
      const hidden = document.hidden;
      const activeCount = this.running.size;

      if (hidden && activeCount > 0) {
        for (const task of this.running.values()) {
          if (task.pendingCheckpointData !== undefined) {
            void this.store.save(this.buildCheckpoint(task, "interrupted"));
          }
        }
      }

      this.options.onVisibilityChange?.(hidden, activeCount);
    };

    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private removeVisibilityListener(): void {
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }
}
