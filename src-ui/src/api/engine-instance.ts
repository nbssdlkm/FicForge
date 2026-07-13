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
  FileChapterSummaryRepository,
  FileDraftRepository,
  FileFactRepository,
  FileFandomRepository,
  FileOpsRepository,
  FileProjectRepository,
  FileSettingsRepository,
  FileStateRepository,
  FileSimpleChatRepository,
  FileThreadRepository,
  TrashService,
  RagManager,
  CharacterAliasManager,
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
    chapterSummary: FileChapterSummaryRepository;
    draft: FileDraftRepository;
    fact: FileFactRepository;
    fandom: FileFandomRepository;
    ops: FileOpsRepository;
    project: FileProjectRepository;
    settings: FileSettingsRepository;
    state: FileStateRepository;
    simpleChat: FileSimpleChatRepository;
    thread: FileThreadRepository;
  };
  trash: TrashService;
  ragManager: RagManager;
  characterAliases: CharacterAliasManager;
  taskRunner: TaskRunner;
}

let _engine: EngineInstance | null = null;

export function initEngine(adapter: PlatformAdapter, dataDir: string): void {
  // 防重复 initEngine 泄漏 visibility 订阅（E4 审）：TaskRunner 构造期订阅 adapter.onVisibilityChange，
  // 重复 init 会累积订阅且旧 runner 的在途任务不被中止。销毁上一实例的 taskRunner（abort + 退订）后再重建。
  _engine?.taskRunner.destroy();

  if (hasLogger()) getLogger().info("engine", "initEngine", { platform: adapter.getPlatform(), dataDir });

  _engine = {
    adapter,
    dataDir,
    repos: {
      chapter: new FileChapterRepository(adapter),
      chapterSummary: new FileChapterSummaryRepository(adapter),
      draft: new FileDraftRepository(adapter),
      fact: new FileFactRepository(adapter),
      fandom: new FileFandomRepository(adapter, dataDir),
      ops: new FileOpsRepository(adapter),
      project: new FileProjectRepository(adapter),
      settings: new FileSettingsRepository(adapter, dataDir),
      state: new FileStateRepository(adapter),
      simpleChat: new FileSimpleChatRepository(adapter),
      thread: new FileThreadRepository(adapter),
    },
    trash: new TrashService(adapter),
    // TD-017：per-AU 引擎工厂 —— 每 AU 独立 JsonVectorEngine 实例，消除跨 AU 共享内存竞态。
    ragManager: new RagManager(() => new JsonVectorEngine(adapter)),
    // 角色别名归一化表（per-AU 缓存）：engine-facts 提取/编辑/落库消费，engine-lore 等写入口失效。
    characterAliases: new CharacterAliasManager(adapter),
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

/**
 * 当前运行平台（tauri / capacitor / web）。UI 组件经此单点取，不直接 reach getEngine().adapter
 * ——组件不该穿透 api 层摸引擎内部（盲审 R5 架构 L2）。
 */
export function getCurrentPlatform(): ReturnType<EngineInstance["adapter"]["getPlatform"]> {
  return getEngine().adapter.getPlatform();
}

/**
 * 读取 AU 项目配置，缺失即抛（get 契约 2026-07-09：repo.get 缺失返回 null）。
 * API 层大多数路径要求 project.yaml 必须存在（合法 AU 的结构前提），
 * 统一经此 helper 取，避免各处手写 null 检查。错误文案与旧 repo 抛错一致。
 */
export async function getProjectOrThrow(auPath: string) {
  const proj = await getEngine().repos.project.get(auPath);
  if (!proj) throw new Error(`project.yaml not found: ${auPath}/project.yaml`);
  return proj;
}

/**
 * 读取章节，缺失即抛（同上契约）。用于「章节必须存在」的 API 路径。
 */
export async function getChapterOrThrow(auPath: string, chapterNum: number) {
  const ch = await getEngine().repos.chapter.get(auPath, chapterNum);
  if (!ch) throw new Error(`Chapter not found: ${auPath} ch${chapterNum}`);
  return ch;
}
