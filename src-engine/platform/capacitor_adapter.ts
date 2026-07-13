// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * CapacitorAdapter — 移动端（Android/iOS）PlatformAdapter 实现。
 * 使用 @capacitor/filesystem 进行文件 I/O。
 */

import type { OpenDialogOptions, PlatformAdapter, SaveDialogOptions, SecretStorageCapabilities } from "./adapter.js";
import { SecretStoreReadError } from "./adapter.js";
import {
  base64ToUint8,
  kvGetWithFallback,
  kvRemoveWithFallback,
  kvSetWithFallback,
  legacySecureStorageKey,
  OS_KEYRING_CAPABILITIES,
  platformWarn,
  redactSecureKey,
  scrubKeyFromError,
  sharedOnVisibilityChange,
  uint8ToBase64,
} from "./shared.js";

/**
 * secure storage 诊断日志的 debug gate（L13）。
 *
 * secureGet/Set/Remove 的 console.info 诊断行里带 `key=`，而 key 名含作品/AU 名（如
 * `apiKey:某同人作品`）。生产构建这些 info 会打进 logcat，明文外泄作品名到设备日志。
 * 默认关闭；真机排障时可在启动前置 `globalThis.__FICFORGE_SECURE_DEBUG__ = true` 打开。
 * 失败路径的告警不受此 gate 影响（诊断价值高、频率低，保持恒开），但 key 名一律经
 * redactSecureKey 脱敏 —— 恒开路径不允许出现明文 key 名。
 */
function secureDebugEnabled(): boolean {
  return (globalThis as { __FICFORGE_SECURE_DEBUG__?: boolean }).__FICFORGE_SECURE_DEBUG__ === true;
}

function secureDebugLog(message: string): void {
  if (!secureDebugEnabled()) return;
  // biome-ignore lint/suspicious/noConsole: 默认关闭的真机排障通道（__FICFORGE_SECURE_DEBUG__ gate）
  console.info(message);
}

export class CapacitorAdapter implements PlatformAdapter {
  private _deviceId: string;

  constructor(deviceId?: string) {
    this._deviceId = deviceId ?? crypto.randomUUID();
  }

  setDeviceId(deviceId: string): void {
    this._deviceId = deviceId;
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
    // 「正式文件缺失 + .tmp 完整」——JSONL 由 readJsonl 的 .tmp 恢复兜底，
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

  async readBinary(path: string): Promise<Uint8Array<ArrayBuffer>> {
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
    throw new Error(`CapacitorAdapter.readBinary: unexpected data type ${Object.prototype.toString.call(data)}`);
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

  async statEntry(path: string): Promise<"file" | "directory" | "missing"> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    try {
      const info = await Filesystem.stat({ path: this.normPath(path), directory: Directory.Data });
      return info.type === "directory" ? "directory" : "file";
    } catch {
      return "missing";
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
    return kvGetWithFallback("CapacitorAdapter", this._kvFallback, key);
  }

  async kvSet(key: string, value: string): Promise<void> {
    kvSetWithFallback("CapacitorAdapter", this._kvFallback, key, value);
  }

  async kvRemove(key: string): Promise<void> {
    kvRemoveWithFallback("CapacitorAdapter", this._kvFallback, key);
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
   * 真机故障诊断靠 secureDebugLog（默认关，L13 gate）/ console.warn — 用 logcat 抓
   * `[CapacitorAdapter.secure]` 标签（info 级需先开 __FICFORGE_SECURE_DEBUG__）。
   */
  async secureGet(key: string): Promise<string | null> {
    secureDebugLog(`[CapacitorAdapter.secure] get enter, key=${redactSecureKey(key)}`);
    let stored: string | null;
    try {
      stored = await this.invokeSecureStoreGet(key);
    } catch (err) {
      // Keystore 故障窗口内如果旧版 localStorage 明文还在（未迁移用户），直接返回真值；
      // 但不在故障期做迁移写入（setItem 大概率同样失败，且半成功会丢明文副本）。
      const legacyValue = this.getLegacySecureValue(key);
      if (legacyValue !== null) {
        platformWarn("CapacitorAdapter.secure", "plugin get failed but legacy value present (migration deferred)", {
          key_redacted: redactSecureKey(key),
        });
        return legacyValue;
      }
      throw err;
    }
    if (stored !== null) {
      secureDebugLog(
        `[CapacitorAdapter.secure] get hit (plugin), key=${redactSecureKey(key)}, empty=${stored.length === 0}`,
      );
      this.removeLegacySecureValue(key);
      return stored;
    }

    const legacyValue = this.getLegacySecureValue(key);
    if (legacyValue === null) {
      secureDebugLog(`[CapacitorAdapter.secure] get miss (plugin + legacy), key=${redactSecureKey(key)}`);
      return null;
    }

    secureDebugLog(
      `[CapacitorAdapter.secure] get hit (legacy), migrating, key=${redactSecureKey(key)}, empty=${legacyValue.length === 0}`,
    );
    await this.invokeSecureStoreSet(key, legacyValue);
    this.removeLegacySecureValue(key);
    return legacyValue;
  }

  /**
   * 写入敏感字段。失败时抛出 —— 上层 saveSettings 链路会感知到错误，
   * 在 GlobalSettingsModal 的 catch 里弹错误 toast，避免"看似成功"的静默丢数据。
   */
  async secureSet(key: string, value: string): Promise<void> {
    secureDebugLog(`[CapacitorAdapter.secure] set enter, key=${redactSecureKey(key)}, empty=${value.length === 0}`);
    await this.invokeSecureStoreSet(key, value);
    this.removeLegacySecureValue(key);
    secureDebugLog(`[CapacitorAdapter.secure] set OK, key=${redactSecureKey(key)}`);
  }

  async secureRemove(key: string): Promise<void> {
    secureDebugLog(`[CapacitorAdapter.secure] remove enter, key=${redactSecureKey(key)}`);
    await this.invokeSecureStoreRemove(key);
    this.removeLegacySecureValue(key);
    secureDebugLog(`[CapacitorAdapter.secure] remove OK, key=${redactSecureKey(key)}`);
  }

  getSecretStorageCapabilities(): SecretStorageCapabilities {
    return OS_KEYRING_CAPABILITIES;
  }

  onVisibilityChange(cb: (state: "visible" | "hidden") => void): () => void {
    return sharedOnVisibilityChange(cb);
  }

  private getLegacySecureStorageKey(key: string): string {
    return legacySecureStorageKey(key);
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
    } catch {
      // 有意静默：best-effort 清理旧存储；隐私模式下 localStorage 每次调用都抛，
      // 读路径同样降级（读不到=无旧数据），告警只会刷屏无诊断价值
    }
  }

  private async invokeSecureStoreGet(key: string): Promise<string | null> {
    try {
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      const value = await SecureStorage.getItem(key);
      // 插件返回 null = 没存过；返回字符串 = 存过。两者都是正常路径，不告警。
      return value;
    } catch (err) {
      // 抛错 ≠ 没存过（审计 H8）：吞成 null 会让保存链路误删真 key。抛专用错误上浮。
      platformWarn("CapacitorAdapter.secure", "plugin getItem threw", {
        key_redacted: redactSecureKey(key),
        error: scrubKeyFromError(err, key),
      });
      throw new SecretStoreReadError(key, err);
    }
  }

  private async invokeSecureStoreSet(key: string, value: string): Promise<void> {
    try {
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      await SecureStorage.setItem(key, value);
    } catch (err) {
      platformWarn("CapacitorAdapter.secure", "plugin setItem threw", {
        key_redacted: redactSecureKey(key),
        error: scrubKeyFromError(err, key),
      });
      throw err;
    }
  }

  private async invokeSecureStoreRemove(key: string): Promise<void> {
    try {
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      await SecureStorage.removeItem(key);
    } catch (err) {
      platformWarn("CapacitorAdapter.secure", "plugin removeItem threw", {
        key_redacted: redactSecureKey(key),
        error: scrubKeyFromError(err, key),
      });
      throw err;
    }
  }
}
