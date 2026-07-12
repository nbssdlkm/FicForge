// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FontsService — 字体系统门面。
 *
 * 编排三个子系统：
 * - `FontStorage`  — 本地二进制持久化
 * - `FontDownloader` — 网络下载（多源 + 校验）
 * - `FontRegistry`   — 运行时 FontFace 注入
 *
 * 调用方（UI / hooks / settings）只与 FontsService 交互，不直接触碰子系统。
 *
 * 并发策略：同一字体不允许并发下载。重复调用 install 会抛 FontError("network", ...)。
 */

import { FONT_MANIFEST, getFontById } from "./manifest.js";
import type { FontDownloader, ProgressCallback } from "./downloader.js";
import type { FontRegistry } from "./registry.js";
import type { FontStorage } from "./storage.js";
import { warnAlways } from "../logger/index.js";
import { FontError, type DownloadProgress, type FontEntry, type FontStatus } from "./types.js";

export interface InstallOptions {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

/**
 * 下载生命周期事件。订阅者用它在 service 单例层（而非组件层）跟踪进度，
 * 从而让进度条跨 UI 生命周期（如 Modal 关闭再打开）存活。见 TD-011。
 *
 * - `progress`：下载推进，携带最新 loaded/total。
 * - `settled`：下载结束（成功 / 失败 / 取消任一）。订阅者应据此清理该 id 的
 *   进度并重新查询状态 —— `settled` 不区分结果，因为成功与否由 `statusOf`
 *   （读 storage）决定，失败 / 取消的错误展示由发起方自行处理。
 */
export type FontDownloadEvent =
  | { readonly type: "progress"; readonly id: string; readonly progress: DownloadProgress }
  | { readonly type: "settled"; readonly id: string };

export type FontDownloadListener = (event: FontDownloadEvent) => void;

export class FontsService {
  private readonly pendingDownloads = new Map<string, AbortController>();

  /**
   * 进行中下载的进度真相源。key = 字体 id。下载结束时删除。
   * UI 晚挂载（Modal 重开）时用 `currentProgresses()` 读它做进度条初值。
   */
  private readonly progresses = new Map<string, DownloadProgress>();

  /** 下载事件订阅者。install 推进 / 结束时通知，用于驱动跨生命周期的进度 UI。 */
  private readonly downloadListeners = new Set<FontDownloadListener>();

  constructor(
    private readonly storage: FontStorage,
    private readonly downloader: FontDownloader,
    private readonly registry: FontRegistry,
  ) {}

  /** 列出 manifest 全部字体（只读引用）。 */
  listAvailable(): readonly FontEntry[] {
    return FONT_MANIFEST;
  }

  /** 查询字体运行时状态。 */
  async statusOf(id: string): Promise<FontStatus> {
    const entry = getFontById(id);
    if (!entry) return "not-installed";
    if (this.pendingDownloads.has(id)) return "downloading";
    // 内置字体通过 HTML <link rel="stylesheet"> + <link rel="preload"> 由浏览器
    // 静态加载（见 index.html），不经过 Registry。随应用包分发，一定可用。
    if (entry.type === "builtin") return "installed";
    return (await this.storage.exists(id)) ? "installed" : "not-installed";
  }

  /** 是否正在下载。 */
  isDownloading(id: string): boolean {
    return this.pendingDownloads.has(id);
  }

  /**
   * 安装字体。
   *
   * - `builtin` 字体：no-op。内置字体由 index.html 的 `<link>` 静态加载，
   *   应用启动即可用，无需 JS 显式安装。对 UI 调用方是幂等的"已安装"语义。
   * - `downloadable` 字体：下载 → 校验 → 落盘 → 注册。并发调用抛错。
   */
  async install(id: string, options: InstallOptions = {}): Promise<void> {
    const entry = getFontById(id);
    if (!entry) throw new FontError("not-found", `Font not found in manifest: ${id}`);

    if (entry.type === "builtin") {
      // no-op：HTML 已加载，无需 JS 参与。
      return;
    }

    if (this.pendingDownloads.has(id)) {
      throw new FontError("network", `Font already downloading: ${id}`);
    }

    const controller = new AbortController();
    // 将外部 signal 合并到内部 controller：任一触发即取消。
    // 监听器在 finally 中显式移除，避免 install 正常完成后监听器悬挂在
    // 长生命周期 signal 上（每次 install 积累一个 → 内存泄漏）。
    const onExternalAbort = (): void => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener("abort", onExternalAbort);
    }

    this.pendingDownloads.set(id, controller);
    // 进度真相源住在 service：无论调用方是否传 onProgress（也无论调用方所属的
    // UI 是否还挂载），service 都记录并广播进度，使晚挂载的订阅者能续上。
    const trackProgress: ProgressCallback = (progress) => {
      this.progresses.set(id, progress);
      this.emitDownloadEvent({ type: "progress", id, progress });
      options.onProgress?.(progress);
    };
    try {
      const data = await this.downloader.download(entry, trackProgress, controller.signal);
      await this.storage.write(id, data);
      try {
        await this.registry.registerFromData(entry, data);
      } catch (registerErr) {
        // registry 注册失败（字体字节损坏 / FontFace.load 抛错）时回滚 storage，
        // 避免"disk 有文件但 registry 未注册"的半状态——这种状态下 statusOf
        // 会误报 "installed" 却 CSS 用不到字体，下次 hydrate 再失败形成循环。
        try {
          await this.storage.remove(id);
        } catch {
          /* 清理失败就忽略，不覆盖原始错误 */
        }
        throw registerErr;
      }
    } finally {
      this.pendingDownloads.delete(id);
      // 先清进度再广播 settled：订阅者在回调里查 currentProgresses() 即见已清状态。
      this.progresses.delete(id);
      this.emitDownloadEvent({ type: "settled", id });
      options.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  /**
   * 进行中下载的进度快照（id → loaded/total）。
   *
   * 供晚挂载的 UI（如设置 Modal 重新打开）在订阅前读取初值，从而即时显示
   * 已进行的下载进度，而不是等下一个 progress 事件。见 TD-011。
   */
  currentProgresses(): Record<string, DownloadProgress> {
    return Object.fromEntries(this.progresses);
  }

  /**
   * 订阅下载进度 / 结束事件。返回取消订阅函数（在 UI 卸载时调用）。
   *
   * 让进度条跨组件生命周期存活：组件卸载只是退订，service 仍持续记录后台下载；
   * 重新挂载时先 `currentProgresses()` 播种、再订阅增量。
   */
  subscribeDownloads(listener: FontDownloadListener): () => void {
    this.downloadListeners.add(listener);
    return () => {
      this.downloadListeners.delete(listener);
    };
  }

  /** 向所有订阅者广播下载事件。单个监听器抛错被隔离，不影响下载或其他监听器。 */
  private emitDownloadEvent(event: FontDownloadEvent): void {
    for (const listener of this.downloadListeners) {
      try {
        listener(event);
      } catch (e) {
        warnAlways("FontsService", `download listener threw for ${event.id}`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  /**
   * 从本地存储加载字体字节并注册到 FontFace。用于应用启动时恢复已下载字体。
   *
   * 内置字体 no-op（HTML 静态加载负责）。未下载的字体静默跳过。
   */
  async hydrate(id: string): Promise<void> {
    const entry = getFontById(id);
    if (!entry) throw new FontError("not-found", `Font not found in manifest: ${id}`);
    if (entry.type === "builtin") return; // HTML <link> 已加载
    if (!(await this.storage.exists(id))) return;
    const data = await this.storage.read(id);
    await this.registry.registerFromData(entry, data);
  }

  /**
   * 启动时批量 hydrate：所有本地已下载字体。
   *
   * 内置字体由 HTML 负责，不进此流程。单个字体 hydrate 失败不阻断其他字体
   * （Promise.allSettled）。
   */
  async hydrateAll(): Promise<void> {
    const ids = new Set<string>();
    for (const id of await this.storage.list()) {
      if (getFontById(id)) ids.add(id);
    }
    await Promise.allSettled([...ids].map((id) => this.hydrate(id)));
  }

  /** 取消进行中的下载。非下载状态静默。 */
  abort(id: string): void {
    const controller = this.pendingDownloads.get(id);
    controller?.abort();
  }

  /**
   * 已下载字体占用的磁盘总字节。
   *
   * 走真实 storage 层（fonts/ 目录下所有文件字节累加），比用 manifest.sizeBytes
   * 估算更准确 —— 后者在 Phase 1 阶段是占位值，可能与真实下载文件大小偏差。
   */
  async totalStorageSize(): Promise<number> {
    return this.storage.totalSize();
  }

  /**
   * 卸载字体（仅适用于 downloadable）。
   *
   * 卸载 FontFace + 删除本地文件。对内置字体抛 `unsupported` —— 内置字体
   * 随应用包分发，无法真正移除（即使 unregister，下次启动 hydrateAll 又会
   * 注册回来），静默 no-op 会让用户困惑 "为什么点卸载没反应"，不如显式抛错，
   * 让 UI 根据 entry.type 提前禁用卸载按钮。
   */
  async uninstall(id: string): Promise<void> {
    const entry = getFontById(id);
    if (!entry) throw new FontError("not-found", `Font not found in manifest: ${id}`);
    if (entry.type === "builtin") {
      throw new FontError("unsupported", `Cannot uninstall builtin font: ${id} (bundled with the application)`);
    }
    this.registry.unregister(id);
    await this.storage.remove(id);
  }
}
