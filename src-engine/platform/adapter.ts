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
  backend: "local_storage" | "local_storage_with_memory_fallback" | "session_storage_with_memory_fallback" | "memory" | "os_keyring";
  encrypted_at_rest: boolean;
  persistence: "persistent" | "best_effort" | "session_only" | "memory_only";
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
   * 当前平台能力并不一致：Tauri 已接入 OS keyring / keychain，Web / Capacitor
   * 仍是基于 KV 的兼容实现。调用方应结合 `getSecretStorageCapabilities()` 判断
   * 实际安全级别，而不是仅根据方法名推断。
   *
   * TODO: Capacitor 接入 @capacitor-community/secure-storage (Android Keystore / iOS Keychain)；
   *       Web 接入 crypto.subtle 派生密钥加密。
   */
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string): Promise<void>;
  secureRemove(key: string): Promise<void>;
  getSecretStorageCapabilities(): SecretStorageCapabilities;
}
