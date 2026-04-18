// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FontStorage — 字体文件在本地的持久化，基于 PlatformAdapter。
 *
 * 路径约定：`fonts/{id}`（相对 adapter 的数据根，无扩展名）。
 *
 * 为什么不加扩展名：FontFace API 通过字节头识别字体格式（woff2/ttf/otf），
 * 不关心文件后缀；而 manifest 里不同字体的源文件格式不同（ttf / woff2 混合），
 * 统一后缀无意义、反而会误导调试；分别保存扩展名又让调用方心智负担增加。
 * 去掉扩展名后，id 直接作为文件名。service.hydrateAll 通过 manifest 反查
 * 过滤非字体文件。
 *
 * 仅适用于 downloadable 字体；内置字体通过静态资源 URL 加载，不落本地存储。
 */

import type { PlatformAdapter } from "../platform/adapter.js";

const FONTS_DIR = "fonts";

export class FontStorage {
  constructor(private readonly adapter: PlatformAdapter) {}

  private pathOf(id: string): string {
    return `${FONTS_DIR}/${id}`;
  }

  /** 是否已有本地字体文件。 */
  async exists(id: string): Promise<boolean> {
    return this.adapter.exists(this.pathOf(id));
  }

  /** 读取已下载的字体字节。 */
  async read(id: string): Promise<Uint8Array> {
    return this.adapter.readBinary(this.pathOf(id));
  }

  /** 写入字体文件。自动创建 fonts/ 目录。 */
  async write(id: string, data: Uint8Array): Promise<void> {
    await this.adapter.mkdir(FONTS_DIR);
    await this.adapter.writeBinary(this.pathOf(id), data);
  }

  /** 删除字体文件。不存在则静默（幂等）。 */
  async remove(id: string): Promise<void> {
    if (await this.exists(id)) {
      await this.adapter.deleteFile(this.pathOf(id));
    }
  }

  /**
   * 列出 fonts/ 目录下所有文件名（即字体 id）。
   *
   * 目录不存在时返回空数组（而非抛错），便于首次启动场景。
   * 调用方需通过 manifest 反查过滤非预期文件。
   */
  async list(): Promise<string[]> {
    try {
      return await this.adapter.listDir(FONTS_DIR);
    } catch {
      return [];
    }
  }

  /** 单个字体文件的字节大小。文件不存在返回 -1。 */
  async sizeOf(id: string): Promise<number> {
    return this.adapter.getFileSize(this.pathOf(id));
  }

  /** 已下载字体的总占用（字节）。 */
  async totalSize(): Promise<number> {
    const ids = await this.list();
    const sizes = await Promise.all(ids.map((id) => this.sizeOf(id)));
    return sizes.reduce((sum, s) => sum + Math.max(0, s), 0);
  }
}
