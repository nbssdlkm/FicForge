// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FontRegistry — 封装浏览器 FontFace API 的注册 / 卸载。
 *
 * 抽象为 interface 以便在非浏览器环境（Node 单测、SSR）注入 NoopFontRegistry。
 * 实际生产环境使用 BrowserFontRegistry。
 */

import { FontError, type FontEntry } from "./types.js";

/**
 * TS 5.x 的 lib.dom.d.ts 中 FontFaceSet 声明缺失 add/delete（已知 gap）。
 * 此处本地补齐，避免污染全局 types 定义。
 */
type MutableFontFaceSet = FontFaceSet & {
  add(face: FontFace): FontFaceSet;
  delete(face: FontFace): boolean;
};

export interface FontRegistry {
  /** 从二进制数据注册字体（下载后调用）。 */
  registerFromData(entry: FontEntry, data: Uint8Array): Promise<void>;
  /** 从 URL 注册字体（内置字体 / 从静态资源加载）。 */
  registerFromUrl(entry: FontEntry, url: string): Promise<void>;
  /** 卸载已注册字体。未注册则静默。 */
  unregister(id: string): void;
  /** 查询字体是否已注册。 */
  isRegistered(id: string): boolean;
  /** 列出已注册的字体 id。 */
  listRegistered(): string[];
}

/**
 * 浏览器运行时的 FontRegistry 实现。
 *
 * 通过 `new FontFace()` + `document.fonts.add()` 注册，支持从 ArrayBuffer
 * 或 URL 加载。已注册字体通过内部 Map 记录 id → FontFace 映射，便于
 * 后续卸载。
 */
export class BrowserFontRegistry implements FontRegistry {
  private registered = new Map<string, FontFace>();

  private ensureBrowser(): void {
    if (typeof document === "undefined" || !document.fonts) {
      throw new FontError(
        "registry",
        "BrowserFontRegistry requires document.fonts (browser environment)",
      );
    }
  }

  async registerFromData(entry: FontEntry, data: Uint8Array): Promise<void> {
    this.ensureBrowser();
    // 切片成独立 ArrayBuffer，避免与调用方的 Uint8Array 共享底层 buffer。
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const face = new FontFace(entry.family, buf);
    try {
      await face.load();
    } catch (cause) {
      // 新字体加载失败时保留旧字体，不做替换（原子性）。
      throw new FontError("registry", `Failed to load FontFace for ${entry.id}`, cause);
    }
    // 新字体加载成功后才卸载旧实例，保证任何时刻都有一个可用字体。
    this.unregister(entry.id);
    (document.fonts as MutableFontFaceSet).add(face);
    this.registered.set(entry.id, face);
  }

  async registerFromUrl(entry: FontEntry, url: string): Promise<void> {
    this.ensureBrowser();
    // URL 可能含空格 / 中文 / 其他非 ASCII；用 encodeURI 规范化为 CSS url() 合法形式。
    // encodeURI 已将 " 编码为 %22，外层双引号包裹是安全的。
    // 注意：不用 JSON.stringify，它产生的 \uXXXX 不是合法 CSS string escape（CSS 用 \XXXX 空格结尾）。
    const safeUrl = encodeURI(url);
    const face = new FontFace(entry.family, `url("${safeUrl}")`);
    try {
      await face.load();
    } catch (cause) {
      // 同 registerFromData：加载失败保留旧字体。
      throw new FontError("registry", `Failed to load FontFace for ${entry.id} from ${url}`, cause);
    }
    this.unregister(entry.id);
    (document.fonts as MutableFontFaceSet).add(face);
    this.registered.set(entry.id, face);
  }

  unregister(id: string): void {
    const face = this.registered.get(id);
    if (!face) return;
    try {
      (document.fonts as MutableFontFaceSet).delete(face);
    } catch {
      // 某些浏览器已自动回收时 delete 可能抛错，忽略。
    }
    this.registered.delete(id);
  }

  isRegistered(id: string): boolean {
    return this.registered.has(id);
  }

  listRegistered(): string[] {
    return [...this.registered.keys()];
  }
}

/** 非浏览器环境（单测 / SSR）的 no-op 实现。 */
export class NoopFontRegistry implements FontRegistry {
  private ids = new Set<string>();
  async registerFromData(entry: FontEntry, _data: Uint8Array): Promise<void> {
    this.ids.add(entry.id);
  }
  async registerFromUrl(entry: FontEntry, _url: string): Promise<void> {
    this.ids.add(entry.id);
  }
  unregister(id: string): void {
    this.ids.delete(id);
  }
  isRegistered(id: string): boolean {
    return this.ids.has(id);
  }
  listRegistered(): string[] {
    return [...this.ids];
  }
}
