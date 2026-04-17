// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Instance — 核心引擎初始化与访问。
 *
 * 从 engine-client.ts 拆出，消除 engine-client ↔ 领域模块的循环引用。
 * 领域模块（engine-facts.ts 等）只依赖本文件，engine-client.ts 负责
 * re-export 本文件 + 全部领域模块，UI 层 import 路径不变。
 */

import type { PlatformAdapter } from "@ficforge/engine";
import {
  FileChapterRepository,
  FileDraftRepository,
  FileFactRepository,
  FileFandomRepository,
  FileOpsRepository,
  FileProjectRepository,
  FileSettingsRepository,
  FileStateRepository,
  TrashService,
  RagManager,
  JsonVectorEngine,
  TaskRunner,
  getLogger,
  hasLogger,
} from "@ficforge/engine";

// ---------------------------------------------------------------------------
// Engine 实例管理
// ---------------------------------------------------------------------------

export interface EngineInstance {
  adapter: PlatformAdapter;
  dataDir: string;
  repos: {
    chapter: FileChapterRepository;
    draft: FileDraftRepository;
    fact: FileFactRepository;
    fandom: FileFandomRepository;
    ops: FileOpsRepository;
    project: FileProjectRepository;
    settings: FileSettingsRepository;
    state: FileStateRepository;
  };
  trash: TrashService;
  vectorEngine: JsonVectorEngine;
  ragManager: RagManager;
  taskRunner: TaskRunner;
}

let _engine: EngineInstance | null = null;

export function initEngine(adapter: PlatformAdapter, dataDir: string): void {
  if (hasLogger()) getLogger().info("engine", "initEngine", { platform: adapter.getPlatform(), dataDir });

  const vectorEngine = new JsonVectorEngine(adapter);
  _engine = {
    adapter,
    dataDir,
    repos: {
      chapter: new FileChapterRepository(adapter),
      draft: new FileDraftRepository(adapter),
      fact: new FileFactRepository(adapter),
      fandom: new FileFandomRepository(adapter),
      ops: new FileOpsRepository(adapter),
      project: new FileProjectRepository(adapter),
      settings: new FileSettingsRepository(adapter, dataDir),
      state: new FileStateRepository(adapter),
    },
    trash: new TrashService(adapter),
    vectorEngine,
    ragManager: new RagManager(vectorEngine),
    taskRunner: new TaskRunner(adapter, dataDir),
  };
}

export function getEngine(): EngineInstance {
  if (!_engine) throw new Error("Engine not initialized. Call initEngine() first.");
  return _engine;
}

export function isEngineReady(): boolean {
  return _engine !== null;
}

/** 获取数据根目录（所有 fandom 操作的基础路径）。 */
export function getDataDir(): string {
  return getEngine().dataDir;
}

/** 异步获取显示用数据路径（Capacitor 返回 file:// URI，Tauri 返回绝对路径）。 */
export async function getDisplayDataDir(): Promise<string> {
  return getEngine().adapter.getDataDir();
}
