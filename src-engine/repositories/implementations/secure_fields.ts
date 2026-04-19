// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Secure fields —— YAML 持久化时的敏感字段脱敏 / 还原抽象层。
 *
 * ============================================================================
 * 设计动机
 * ============================================================================
 * 多个 repo 都有"把明文 YAML 里的敏感字段抽到 secure storage"这类需求：
 *   - settings.yaml：default_llm.api_key / embedding.api_key / webdav.password
 *   - project.yaml（per-AU）：llm.api_key / embedding_lock.api_key
 *   - 未来可能新增：fandom 级、用户档案级
 *
 * 原先只在 file_settings.ts 内写死，file_project.ts 漏掉导致 AU 级 api_key
 * 明文进 project.yaml（审计 P1 问题）。本模块把机制抽象，所有 repo 共用一套
 * 逻辑，新增字段只需写 spec 常量。
 *
 * ============================================================================
 * 语义契约
 * ============================================================================
 * extractSecureFields —— 在 yaml.dump 之前调用：
 *   对每个 spec，如果对象上该字段值非空、非占位符，就把值写入 secure storage
 *   （key 由 spec.secureKey 指定），并把对象上的字段值替换为 "<secure>" 占位符。
 *   之后 yaml.dump 出来的文本不会含明文。
 *
 * restoreSecureFields —— 在 yaml.load 解析后调用：
 *   对每个 spec，
 *     - 如果字段是占位符 → 从 secure storage 读取真实值填回；读不到就置空
 *     - 如果字段为空 → 尝试从 secure storage 读取（新设备首次读旧 YAML 时）
 *     - 如果字段是明文（非占位符、非空）→ 说明是旧版本写的 YAML，
 *       自动搬运到 secure storage（下次 save 时会写占位符），实现无感迁移
 *
 * removeSecureFields —— 删除 AU / Fandom 时调用：
 *   清理对应的所有 secureKey，避免孤儿数据留在 secure storage 里。
 *
 * ============================================================================
 * key 命名规范
 * ============================================================================
 *   - settings.* —— 全局设置
 *   - project.{au_id}.* —— AU 级覆盖（用 au_id 做 namespace，支持多 AU）
 *   - 未来如 fandom.{name}.* 也按此规范
 * spec.secureKey 由调用方（factory 函数）生成完整 key，本模块不做拼接。
 */

import type { PlatformAdapter } from "../../platform/adapter.js";
import { createAdapterSecretStore } from "../../platform/secret_store.js";

/** YAML 中占位符。固定不变，跨 repo 共享语义。 */
export const SECURE_PLACEHOLDER = "<secure>";

/**
 * 单个敏感字段的访问规格。
 * - secureKey：完整的 secure storage key（调用方负责 namespace）
 * - get：从对象读字段当前值（可能为占位符、明文或空）
 * - set：往对象写字段值
 */
export interface SecureFieldSpec<T> {
  secureKey: string;
  get: (obj: T) => string;
  set: (obj: T, value: string) => void;
}

/**
 * 持久化前脱敏。对每个 spec：
 *   非空、非占位符 → 写 secure storage，对象字段替换为占位符
 *   其它情况（空 / 已是占位符）→ 不动
 */
export async function extractSecureFields<T>(
  obj: T,
  specs: SecureFieldSpec<T>[],
  adapter: PlatformAdapter,
): Promise<void> {
  const secretStore = createAdapterSecretStore(adapter);
  for (const spec of specs) {
    const value = spec.get(obj);
    if (value && value !== SECURE_PLACEHOLDER) {
      await secretStore.set(spec.secureKey, value);
      spec.set(obj, SECURE_PLACEHOLDER);
    }
  }
}

/**
 * 读取后还原。兼容三种历史格式：
 *   1) 新格式（占位符）→ 从 secure storage 读；读不到置空
 *   2) 空值 → 可能是新设备首次读，尝试从 secure storage 读
 *   3) 明文（未迁移的旧 YAML）→ 保留明文的同时写进 secure storage，
 *      下次 save 时 extractSecureFields 会替换为占位符 —— 无感迁移
 */
export async function restoreSecureFields<T>(
  obj: T,
  specs: SecureFieldSpec<T>[],
  adapter: PlatformAdapter,
): Promise<void> {
  const secretStore = createAdapterSecretStore(adapter);
  for (const spec of specs) {
    const current = spec.get(obj);
    if (current === SECURE_PLACEHOLDER || current === "") {
      const stored = await secretStore.get(spec.secureKey);
      if (stored) {
        spec.set(obj, stored);
      } else if (current === SECURE_PLACEHOLDER) {
        // 占位符但读不到 —— 可能是 secure storage 被清空，置空让用户重填
        spec.set(obj, "");
      }
    } else if (current && current !== SECURE_PLACEHOLDER) {
      // 旧格式明文 → 写进 secure storage（下次 save 会变占位符）
      await secretStore.set(spec.secureKey, current);
    }
  }
}

/**
 * 删除对象时调用，清理该对象所有 secure storage 条目。
 * 避免 AU / Fandom 被删后 secureStorage 留下孤儿 key。
 */
export async function removeSecureFields(
  secureKeys: string[],
  adapter: PlatformAdapter,
): Promise<void> {
  const secretStore = createAdapterSecretStore(adapter);
  for (const key of secureKeys) {
    try {
      await secretStore.remove(key);
    } catch {
      // best-effort 清理，失败不阻断 delete 主流程
    }
  }
}
