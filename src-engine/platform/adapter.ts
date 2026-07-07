// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** PlatformAdapter 接口定义。 */

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface OpenDialogOptions {
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}

export interface SecretStorageCapabilities {
  backend: "local_storage" | "local_storage_with_memory_fallback" | "session_storage_with_memory_fallback" | "session_storage_plaintext_fallback" | "web_crypto_aes_gcm" | "memory" | "os_keyring";
  encrypted_at_rest: boolean;
  persistence: "persistent" | "best_effort" | "session_only" | "memory_only";
}

/**
 * secure storage「读取失败」专用错误（审计 H8）。
 *
 * 核心不变量：**读失败 ≠ 空值**。OS keystore 瞬时故障（Android Keystore 抖动 /
 * 解锁窗口 / 备份恢复）若被吞成 null，上层无法区分「没存过」和「存过但读不到」，
 * 会在保存设置时按空值语义删掉 secure storage 里的真 key。适配器在底层后端
 * 抛错时必须抛出本错误（而不是返回 null），让消费方（如 restoreSecureFields）
 * 把字段保持「已存储」占位语义。
 */
export class SecretStoreReadError extends Error {
  readonly key: string;

  constructor(key: string, cause?: unknown) {
    super(`secure storage read failed for key "${key}"${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "SecretStoreReadError";
    this.key = key;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * 路径语义约定：
 * - readFile / writeFile / deleteFile：path 不得为空字符串，否则抛出异常。
 * - listDir / exists / mkdir：空字符串视为数据根目录。
 * - Tauri 使用绝对路径；Capacitor 使用 Directory.Data 相对路径（前导 `/` 自动去除）；
 *   Web 使用虚拟路径（归一化后无前导/尾随 `/`）。
 */
export interface PlatformAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;

  /**
   * 同目录移动 / 重命名（审计 H5，服务于 write-tmp-then-rename 真原子写）。
   *
   * 语义契约：
   * - 目标已存在时**覆盖**（POSIX rename 语义）；
   * - 仅承诺同目录移动（原子写的 .tmp 与正式文件同目录），跨目录/跨挂载点行为不保证；
   * - 源不存在时抛错。
   *
   * 三端原子性：Tauri（Rust std::fs::rename，Unix rename / Windows
   * MoveFileExW+REPLACE_EXISTING）与 Capacitor（原生 FS move）为文件系统级原子替换；
   * Web（IndexedDB）以单记录 put 模拟——见 WebAdapter.rename 注释。
   */
  rename(oldPath: string, newPath: string): Promise<void>;

  listDir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;

  /**
   * 二进制文件 I/O：用于字体、图片等非文本资源。
   *
   * 路径语义与 readFile/writeFile 一致。writeBinary 会自动创建中间目录。
   * 大文件注意事项：Capacitor 端会通过 base64 中转，单次写入 ≥50MB 时可能
   * 因 WebView 内存压力失败，调用方应对该场景做分块处理。
   */
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;

  /**
   * 获取文件字节大小。
   *
   * 返回 -1 的情况：文件不存在、path 为空字符串、底层 stat 抛错。
   * 设计为返回值而非抛错，便于断点续传 / 缓存占用统计 / 存在性探测等幂等场景。
   *
   * 三端实现差异：Tauri / Capacitor 走 stat，O(1)；Web（IndexedDB）无 stat API，
   * 实际需要读取文件测长度，O(n)。调用方在 Web 平台的热路径上应避免高频调用。
   */
  getFileSize(path: string): Promise<number>;

  showSaveDialog(options: SaveDialogOptions): Promise<string | null>;
  showOpenDialog(options: OpenDialogOptions): Promise<string | null>;

  getPlatform(): "tauri" | "capacitor" | "web";
  getDataDir(): Promise<string>;
  getDeviceId(): string;

  /**
   * 键值存储：跨平台安全的 localStorage 替代。
   *
   * kvSet 在持久化失败时会抛出异常（Tauri）或回退到内存 Map 并输出
   * console.warn（Capacitor/Web）。调用方应当意识到内存回退的数据不会
   * 跨页面/重启持久化。
   */
  kvGet(key: string): Promise<string | null>;
  kvSet(key: string, value: string): Promise<void>;
  kvRemove(key: string): Promise<void>;

  /**
   * 敏感数据存储：用于 API key、密码等字段，使其不出现在 settings.yaml 明文中。
   *
   * 当前平台能力：Tauri（keyring crate）和 Capacitor（@aparajita/
   * capacitor-secure-storage，Android Keystore / iOS Keychain）走 OS 级加密存储；
   * Web 走 crypto.subtle AES-GCM（密钥不可导出，存独立 IndexedDB；密文存
   * sessionStorage，仅会话级），无 OS keychain 时退回明文。调用方应结合
   * `getSecretStorageCapabilities()` 判断实际安全级别，而不是仅根据方法名推断。
   */
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string): Promise<void>;
  secureRemove(key: string): Promise<void>;
  getSecretStorageCapabilities(): SecretStorageCapabilities;
}
