// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * CapacitorAdapter — 移动端（Android/iOS）PlatformAdapter 实现。
 * 使用 @capacitor/filesystem 进行文件 I/O。
 */

import type { OpenDialogOptions, PlatformAdapter, SaveDialogOptions, SecretStorageCapabilities } from "./adapter.js";
import { SecretStoreReadError } from "./adapter.js";

const LEGACY_SECURE_KEY_PREFIX = "__secure__:";

/**
 * Uint8Array ↔ base64 分块转换。
 *
 * 直接 `String.fromCharCode(...u8)` 在数组长度 ≥ 约 65535 时触发 "Maximum call stack
 * size exceeded"。我们按 32KB 分块处理，对 ~10MB 字体文件安全。
 */
const BASE64_CHUNK = 0x8000; // 32 KiB

function uint8ToBase64(data: Uint8Array): string {
  // 数组收集 + 末端 join("")：O(n)。比 `binary += ...` 累加字符串
  // （在某些 JS 引擎实现下是 O(n²)）更稳，对 7MB 字体数据差异显著。
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += BASE64_CHUNK) {
    parts.push(String.fromCharCode(...data.subarray(i, i + BASE64_CHUNK)));
  }
  return btoa(parts.join(""));
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export class CapacitorAdapter implements PlatformAdapter {
  private _deviceId: string;

  constructor(deviceId?: string) {
    this._deviceId = deviceId ?? crypto.randomUUID();
  }

  /** Capacitor Filesystem 使用 Directory.Data 为根，path 必须是相对路径。 */
  private normPath(path: string): string {
    return path.replace(/^\/+/, "");
  }

  async readFile(path: string): Promise<string> {
    if (!path || !this.normPath(path)) throw new Error("readFile: path must not be empty");
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    const result = await Filesystem.readFile({
      path: this.normPath(path),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return result.data as string;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!path || !this.normPath(path)) throw new Error("writeFile: path must not be empty");
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({
      path: this.normPath(path),
      data: content,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }

  async deleteFile(path: string): Promise<void> {
    if (!path || !this.normPath(path)) throw new Error("deleteFile: path must not be empty");
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.deleteFile({ path: this.normPath(path), directory: Directory.Data });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (!oldPath || !this.normPath(oldPath)) throw new Error("rename: oldPath must not be empty");
    if (!newPath || !this.normPath(newPath)) throw new Error("rename: newPath must not be empty");
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    // 接口契约要求「目标存在则覆盖」，但 Capacitor 原生实现（iOS NSFileManager
    // moveItem / Android File.renameTo 的部分路径）在目标已存在时会抛错而不是覆盖。
    // 先删目标再 rename 保证契约一致。代价：删除与 rename 之间崩溃会留下
    // 「正式文件缺失 + .tmp 完整」——JSONL 由 read_jsonl 的 .tmp 恢复兜底，
    // 其余文件此窗口极窄且内容仍完整可手工恢复，严格优于旧版「截断正式文件」。
    try {
      await Filesystem.stat({ path: this.normPath(newPath), directory: Directory.Data });
      await Filesystem.deleteFile({ path: this.normPath(newPath), directory: Directory.Data });
    } catch {
      // stat 抛错 = 目标不存在，无需预删
    }
    await Filesystem.rename({
      from: this.normPath(oldPath),
      to: this.normPath(newPath),
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  }

  async readBinary(path: string): Promise<Uint8Array> {
    if (!path || !this.normPath(path)) throw new Error("readBinary: path must not be empty");
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    // 不指定 encoding：Capacitor 返回 base64 string（web）或 Blob（native Android/iOS）。
    const result = await Filesystem.readFile({
      path: this.normPath(path),
      directory: Directory.Data,
    });
    const data = result.data;
    if (typeof data === "string") return base64ToUint8(data);
    if (data instanceof Blob) {
      const buf = await data.arrayBuffer();
      return new Uint8Array(buf);
    }
    throw new Error(
      `CapacitorAdapter.readBinary: unexpected data type ${Object.prototype.toString.call(data)}`,
    );
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    if (!path || !this.normPath(path)) throw new Error("writeBinary: path must not be empty");
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({
      path: this.normPath(path),
      data: uint8ToBase64(data),
      directory: Directory.Data,
      // 不指定 encoding：Capacitor 将 data 视为 base64 并解码为字节写入。
      recursive: true,
    });
  }

  async getFileSize(path: string): Promise<number> {
    if (!path || !this.normPath(path)) return -1;
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const info = await Filesystem.stat({ path: this.normPath(path), directory: Directory.Data });
      return info.size;
    } catch {
      return -1;
    }
  }

  async listDir(path: string): Promise<string[]> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const result = await Filesystem.readdir({ path: this.normPath(path), directory: Directory.Data });
    return result.files.map((f) => f.name);
  }

  async exists(path: string): Promise<boolean> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    try {
      await Filesystem.stat({ path: this.normPath(path), directory: Directory.Data });
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    try {
      await Filesystem.mkdir({ path: this.normPath(path), directory: Directory.Data, recursive: true });
    } catch {
      // 目录已存在时 Capacitor 可能抛错
    }
  }

  async showSaveDialog(_options: SaveDialogOptions): Promise<string | null> {
    // 移动端：使用 Share API 替代文件保存对话框
    return null;
  }

  async showOpenDialog(_options: OpenDialogOptions): Promise<string | null> {
    // 移动端：使用 Capacitor FilePicker 或系统选择器
    return null;
  }

  getPlatform(): "capacitor" {
    return "capacitor";
  }

  async getDataDir(): Promise<string> {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const result = await Filesystem.getUri({ path: "", directory: Directory.Data });
      return result.uri;
    } catch {
      return "";
    }
  }

  getDeviceId(): string {
    return this._deviceId;
  }

  // KV 存储：Capacitor WebView 支持 localStorage，加内存回退兜底
  private _kvFallback = new Map<string, string>();

  async kvGet(key: string): Promise<string | null> {
    try { return localStorage.getItem(key); }
    catch {
      console.warn(`[CapacitorAdapter] kvGet: localStorage 不可用，使用内存回退（数据不持久化）`);
      return this._kvFallback.get(key) ?? null;
    }
  }

  async kvSet(key: string, value: string): Promise<void> {
    try { localStorage.setItem(key, value); }
    catch {
      console.warn(`[CapacitorAdapter] kvSet: localStorage 不可用，使用内存回退（数据不持久化）`);
      this._kvFallback.set(key, value);
    }
  }

  async kvRemove(key: string): Promise<void> {
    try { localStorage.removeItem(key); }
    catch {
      console.warn(`[CapacitorAdapter] kvRemove: localStorage 不可用，使用内存回退`);
      this._kvFallback.delete(key);
    }
  }

  /**
   * 读取敏感字段。底层走 @aparajita/capacitor-secure-storage（Android Keystore /
   * iOS Keychain）。
   *
   * 插件抛错（Keystore 瞬时故障：Samsung 已知抖动 / 解锁窗口 / 备份恢复）时抛
   * SecretStoreReadError 而不是返回 null（审计 H8）：null 与「没存过」不可区分，
   * 会让 UI 显示 key 为空、用户随手保存设置时按空值语义**删掉 secure storage 里的
   * 真 key**。上层 restoreSecureFields 捕获该错误后保持字段「已存储」占位语义。
   *
   * 真机故障诊断靠 console.info / console.warn — 用 logcat 抓
   * `[CapacitorAdapter.secure]` 标签。
   */
  async secureGet(key: string): Promise<string | null> {
    console.info(`[CapacitorAdapter.secure] get enter, key=${key}`);
    let stored: string | null;
    try {
      stored = await this.invokeSecureStoreGet(key);
    } catch (err) {
      // Keystore 故障窗口内如果旧版 localStorage 明文还在（未迁移用户），直接返回真值；
      // 但不在故障期做迁移写入（setItem 大概率同样失败，且半成功会丢明文副本）。
      const legacyValue = this.getLegacySecureValue(key);
      if (legacyValue !== null) {
        console.warn(`[CapacitorAdapter.secure] plugin get failed but legacy value present, key=${key} (migration deferred)`);
        return legacyValue;
      }
      throw err;
    }
    if (stored !== null) {
      console.info(`[CapacitorAdapter.secure] get hit (plugin), key=${key}, empty=${stored.length === 0}`);
      this.removeLegacySecureValue(key);
      return stored;
    }

    const legacyValue = this.getLegacySecureValue(key);
    if (legacyValue === null) {
      console.info(`[CapacitorAdapter.secure] get miss (plugin + legacy), key=${key}`);
      return null;
    }

    console.info(`[CapacitorAdapter.secure] get hit (legacy), migrating, key=${key}, empty=${legacyValue.length === 0}`);
    await this.invokeSecureStoreSet(key, legacyValue);
    this.removeLegacySecureValue(key);
    return legacyValue;
  }

  /**
   * 写入敏感字段。失败时抛出 —— 上层 saveSettings 链路会感知到错误，
   * 在 GlobalSettingsModal 的 catch 里弹错误 toast，避免"看似成功"的静默丢数据。
   */
  async secureSet(key: string, value: string): Promise<void> {
    console.info(`[CapacitorAdapter.secure] set enter, key=${key}, empty=${value.length === 0}`);
    await this.invokeSecureStoreSet(key, value);
    this.removeLegacySecureValue(key);
    console.info(`[CapacitorAdapter.secure] set OK, key=${key}`);
  }

  async secureRemove(key: string): Promise<void> {
    console.info(`[CapacitorAdapter.secure] remove enter, key=${key}`);
    await this.invokeSecureStoreRemove(key);
    this.removeLegacySecureValue(key);
    console.info(`[CapacitorAdapter.secure] remove OK, key=${key}`);
  }

  getSecretStorageCapabilities(): SecretStorageCapabilities {
    return {
      backend: "os_keyring",
      encrypted_at_rest: true,
      persistence: "persistent",
    };
  }

  private getLegacySecureStorageKey(key: string): string {
    return `${LEGACY_SECURE_KEY_PREFIX}${key}`;
  }

  private getLegacySecureValue(key: string): string | null {
    const legacyKey = this.getLegacySecureStorageKey(key);
    try {
      return localStorage.getItem(legacyKey);
    } catch {
      return this._kvFallback.get(legacyKey) ?? null;
    }
  }

  private removeLegacySecureValue(key: string): void {
    const legacyKey = this.getLegacySecureStorageKey(key);
    this._kvFallback.delete(legacyKey);
    try {
      localStorage.removeItem(legacyKey);
    } catch {}
  }

  private async invokeSecureStoreGet(key: string): Promise<string | null> {
    try {
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      const value = await SecureStorage.getItem(key);
      // 插件返回 null = 没存过；返回字符串 = 存过。两者都是正常路径，不告警。
      return value;
    } catch (err) {
      // 抛错 ≠ 没存过（审计 H8）：吞成 null 会让保存链路误删真 key。抛专用错误上浮。
      console.warn(`[CapacitorAdapter.secure] plugin getItem threw, key=${key}, err=`, err);
      throw new SecretStoreReadError(key, err);
    }
  }

  private async invokeSecureStoreSet(key: string, value: string): Promise<void> {
    try {
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      await SecureStorage.setItem(key, value);
    } catch (err) {
      console.warn(`[CapacitorAdapter.secure] plugin setItem threw, key=${key}, err=`, err);
      throw err;
    }
  }

  private async invokeSecureStoreRemove(key: string): Promise<void> {
    try {
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      await SecureStorage.removeItem(key);
    } catch (err) {
      console.warn(`[CapacitorAdapter.secure] plugin removeItem threw, key=${key}, err=`, err);
      throw err;
    }
  }
}
