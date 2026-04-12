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

  /** 键值存储：跨平台安全的 localStorage 替代。 */
  kvGet(key: string): Promise<string | null>;
  kvSet(key: string, value: string): Promise<void>;
  kvRemove(key: string): Promise<void>;

  /**
   * 敏感数据存储：用于 API key、密码等字段，使其不出现在 settings.yaml 明文中。
   *
   * 当前实现：所有平台均为 KV + `__secure__:` 前缀隔离（未加密）。
   * TODO: Tauri 接入 @tauri-apps/plugin-stronghold (OS keychain)；
   *       Capacitor 接入 @capacitor-community/secure-storage (Android Keystore / iOS Keychain)；
   *       Web 接入 crypto.subtle 派生密钥加密。
   */
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string): Promise<void>;
  secureRemove(key: string): Promise<void>;
}
