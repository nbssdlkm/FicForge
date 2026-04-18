// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileFandomRepository — fandom.yaml 读写实现。参见 PRD §3.2。 */

import yaml from "js-yaml";
import type { PlatformAdapter } from "../../platform/adapter.js";
import type { Fandom } from "../../domain/fandom.js";
import { createFandom } from "../../domain/fandom.js";
import type { FandomRepository } from "../interfaces/fandom.js";
import { joinPath, obj_to_plain, validateBasePath } from "./file_utils.js";

export class FileFandomRepository implements FandomRepository {
  constructor(
    private adapter: PlatformAdapter,
    private readonly dataDir: string,
  ) {
    // dataDir 是数据根目录（可空，Capacitor/Web 约定 "" = 平台 Data 目录）。
    // 不调用 validateBasePath —— 它专用于用户控制的路径段（au_id、fandom_path 等），
    // 对根目录会误拒 ""。joinPath 自动过滤空段，天然兼容所有平台。
    // 与 FileSettingsRepository 构造注入的语义保持一致。
  }

  async get(fandom_path: string): Promise<Fandom> {
    validateBasePath(fandom_path, "fandom_path");
    const path = joinPath(fandom_path, "fandom.yaml");
    const exists = await this.adapter.exists(path);
    if (!exists) {
      throw new Error(`fandom.yaml not found: ${path}`);
    }

    const text = await this.adapter.readFile(path);
    const raw = yaml.load(text) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") {
      return createFandom();
    }

    return createFandom({
      name: (raw.name as string) ?? "",
      created_at: (raw.created_at as string) ?? "",
      core_characters: (raw.core_characters as string[]) ?? [],
      wiki_source: (raw.wiki_source as string) ?? "",
    });
  }

  async save(fandom_path: string, fandom: Fandom): Promise<void> {
    validateBasePath(fandom_path, "fandom_path");
    const path = joinPath(fandom_path, "fandom.yaml");
    const raw = obj_to_plain(fandom);
    const content = yaml.dump(raw, { sortKeys: false, lineWidth: -1 });
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    await this.adapter.writeFile(path, content);
  }

  async list_fandoms(): Promise<string[]> {
    const fandomsDir = joinPath(this.dataDir, "fandoms");
    const exists = await this.adapter.exists(fandomsDir);
    if (!exists) return [];

    const entries = await this.adapter.listDir(fandomsDir);
    const result: string[] = [];
    for (const name of entries.sort()) {
      const fandomYaml = joinPath(fandomsDir, name, "fandom.yaml");
      if (await this.adapter.exists(fandomYaml)) {
        result.push(name);
      }
    }
    return result;
  }

  async list_aus(fandom_path: string): Promise<string[]> {
    validateBasePath(fandom_path, "fandom_path");
    const ausDir = joinPath(fandom_path, "aus");
    const exists = await this.adapter.exists(ausDir);
    if (!exists) return [];

    const entries = await this.adapter.listDir(ausDir);
    return entries.sort();
  }
}
