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
   * @warning **当前未加密。** 所有平台的实现均为 KV + `__secure__:` 前缀隔离，
   * 数据以明文存储在 localStorage 或内存 Map 中。方法名保留 `secure` 前缀以便
   * 未来接入真正的安全存储时无需修改调用点。
   *
   * TODO: Tauri 接入 @tauri-apps/plugin-stronghold (OS keychain)；
   *       Capacitor 接入 @capacitor-community/secure-storage (Android Keystore / iOS Keychain)；
   *       Web 接入 crypto.subtle 派生密钥加密。
   */
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string): Promise<void>;
  secureRemove(key: string): Promise<void>;
}
