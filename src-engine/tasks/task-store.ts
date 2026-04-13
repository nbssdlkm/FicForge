// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 后台任务系统 — 断点持久化。
 *
 * 关键原则：checkpoint 只在批次边界写入，不逐条写入。
 * 每次 checkpoint ≈ 1KB JSON，单次写入 ≈ 5-10ms，总开销可忽略。
 *
 * 存储路径：{dataDir}/.ficforge/tasks/{taskId}.json
 */

import type { PlatformAdapter } from "../platform/index.js";
import type { TaskCheckpoint } from "./types.js";
import { joinPath } from "../repositories/implementations/file_utils.js";

const TASKS_DIR = ".ficforge/tasks";

export class TaskStore {
  private dirCreated = false;

  constructor(
    private adapter: PlatformAdapter,
    private dataDir: string,
  ) {}

  private taskPath(taskId: string): string {
    return joinPath(this.dataDir, TASKS_DIR, `${taskId}.json`);
  }

  private tasksDir(): string {
    return joinPath(this.dataDir, TASKS_DIR);
  }

  /** 写入断点 */
  async save(checkpoint: TaskCheckpoint): Promise<void> {
    if (!this.dirCreated) {
      await this.adapter.mkdir(this.tasksDir());
      this.dirCreated = true;
    }
    const json = JSON.stringify(checkpoint, null, 2);
    await this.adapter.writeFile(this.taskPath(checkpoint.taskId), json);
  }

  /** 读取断点，不存在返回 null */
  async load(taskId: string): Promise<TaskCheckpoint | null> {
    try {
      const json = await this.adapter.readFile(this.taskPath(taskId));
      return JSON.parse(json) as TaskCheckpoint;
    } catch {
      return null;
    }
  }

  /** 删除断点（任务完成/取消后清理） */
  async remove(taskId: string): Promise<void> {
    try {
      await this.adapter.deleteFile(this.taskPath(taskId));
    } catch {
      // 文件不存在，忽略
    }
  }

  /** 列出所有未完成的断点（app 启动时检查） */
  async listInterrupted(): Promise<TaskCheckpoint[]> {
    const dir = this.tasksDir();
    let files: string[];
    try {
      files = await this.adapter.listDir(dir);
    } catch {
      return [];
    }

    const results: TaskCheckpoint[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const json = await this.adapter.readFile(joinPath(dir, file));
        const cp = JSON.parse(json) as TaskCheckpoint;
        if (cp.status === "running" || cp.status === "interrupted") {
          cp.status = "interrupted";
          results.push(cp);
        }
      } catch {
        // 损坏的 checkpoint，跳过
      }
    }
    return results;
  }
}
