// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { redactSecureKey, scrubKeyFromError } from "./shared.js";

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
  backend:
    | "local_storage"
    | "local_storage_with_memory_fallback"
    | "session_storage_with_memory_fallback"
    | "session_storage_plaintext_fallback"
    | "web_crypto_aes_gcm"
    | "memory"
    | "os_keyring";
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
    // message 在构造期即脱敏（B2 对抗审）：key 名内嵌作品/AU 标题，而本错误的 message
    // 会被各层 catch 原样送进日志/console —— 源头不放明文，下游想漏都漏不了。
    // 内层 cause.message（keyring/插件错误串）同样可能拼着原始 key，一并擦。
    super(
      `secure storage read failed for key "${redactSecureKey(key)}"${
        cause instanceof Error ? `: ${scrubKeyFromError(cause, key)}` : ""
      }`,
    );
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
 *
 * 文件不存在时的三端语义（L11 契约测试核对后如实登记——**存在漂移，调用方勿假设统一**）：
 * - readFile / readBinary：一律抛错（三端一致）。
 * - deleteFile：**漂移** —— Web/内存 mock 静默幂等；Tauri（fs.remove）/ Capacitor
 *   （Filesystem.deleteFile）对不存在路径**抛错**。需要「删除即达期望态」的调用方应自行
 *   吞掉不存在错误或先 exists 判断。
 * - listDir：**漂移** —— Web/内存 mock 对不存在目录返回 `[]`；Tauri（fs.readDir）/
 *   Capacitor（Filesystem.readdir）**抛错**。遍历前不确定目录是否存在时应先 exists 或 try/catch。
 * - exists：三端一致——存在返回 true，不存在返回 false（不抛）；有子文件的路径视为「目录存在」。
 * - mkdir：三端幂等（已存在不抛）。
 * - getFileSize：不存在返回 -1（不抛，见下方方法注释）。
 * - rename：目标存在则覆盖，源不存在抛错（三端一致，见 rename 注释）。
 */
export interface PlatformAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** 删除文件。**不存在时**：Web/内存幂等不抛；Tauri/Capacitor 抛错（见接口顶部漂移说明）。 */
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

  /** 列出直接子项名。**目录不存在时**：Web/内存返回 `[]`；Tauri/Capacitor 抛错（见顶部漂移说明）。 */
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
  readBinary(path: string): Promise<Uint8Array<ArrayBuffer>>;
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
   * 采用一个已持久化的 device_id（L14）。受限环境（localStorage 不可用）下构造时会生成新随机
   * ID，但 KV 里可能已存旧 ID —— init 阶段读到已存值时用本方法采用，让 ops device_id 归属稳定，
   * 不再每次重开漂移。仅覆盖内存中的 device_id，不触发任何持久化写。
   */
  setDeviceId(deviceId: string): void;

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
