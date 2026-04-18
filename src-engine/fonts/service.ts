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

import {
  FONT_MANIFEST,
  getFontById,
} from "./manifest.js";
import { FontDownloader, type ProgressCallback } from "./downloader.js";
import type { FontRegistry } from "./registry.js";
import type { FontStorage } from "./storage.js";
import {
  FontError,
  type FontEntry,
  type FontStatus,
} from "./types.js";

export interface InstallOptions {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export class FontsService {
  private readonly pendingDownloads = new Map<string, AbortController>();

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
    if (entry.type === "builtin") {
      return this.registry.isRegistered(id) ? "installed" : "not-installed";
    }
    return (await this.storage.exists(id)) ? "installed" : "not-installed";
  }

  /** 是否正在下载。 */
  isDownloading(id: string): boolean {
    return this.pendingDownloads.has(id);
  }

  /**
   * 安装字体。
   *
   * - `builtin` 字体：直接从 URL 注册到 FontFace。
   * - `downloadable` 字体：下载 → 校验 → 落盘 → 注册。并发调用抛错。
   */
  async install(id: string, options: InstallOptions = {}): Promise<void> {
    const entry = getFontById(id);
    if (!entry) throw new FontError("not-found", `Font not found in manifest: ${id}`);

    if (entry.type === "builtin") {
      await this.registry.registerFromUrl(entry, entry.url);
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
    try {
      const data = await this.downloader.download(entry, options.onProgress, controller.signal);
      await this.storage.write(id, data);
      try {
        await this.registry.registerFromData(entry, data);
      } catch (registerErr) {
        // registry 注册失败（字体字节损坏 / FontFace.load 抛错）时回滚 storage，
        // 避免"disk 有文件但 registry 未注册"的半状态——这种状态下 statusOf
        // 会误报 "installed" 却 CSS 用不到字体，下次 hydrate 再失败形成循环。
        try { await this.storage.remove(id); }
        catch { /* 清理失败就忽略，不覆盖原始错误 */ }
        throw registerErr;
      }
    } finally {
      this.pendingDownloads.delete(id);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  /**
   * 从本地存储（或内置 URL）加载字体并注册。用于应用启动时恢复已安装字体。
   *
   * 未安装的字体（downloadable 且本地不存在）会被静默跳过。
   */
  async hydrate(id: string): Promise<void> {
    const entry = getFontById(id);
    if (!entry) throw new FontError("not-found", `Font not found in manifest: ${id}`);
    if (entry.type === "builtin") {
      await this.registry.registerFromUrl(entry, entry.url);
      return;
    }
    if (!(await this.storage.exists(id))) return;
    const data = await this.storage.read(id);
    await this.registry.registerFromData(entry, data);
  }

  /**
   * 启动时批量 hydrate：所有内置字体 + 所有本地已下载字体。
   *
   * 单个字体 hydrate 失败不阻断其他字体（Promise.allSettled）。
   */
  async hydrateAll(): Promise<void> {
    const ids = new Set<string>();
    for (const entry of FONT_MANIFEST) {
      if (entry.type === "builtin") ids.add(entry.id);
    }
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
      throw new FontError(
        "unsupported",
        `Cannot uninstall builtin font: ${id} (bundled with the application)`,
      );
    }
    this.registry.unregister(id);
    await this.storage.remove(id);
  }
}
