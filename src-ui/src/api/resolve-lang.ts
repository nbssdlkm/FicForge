// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * settings.app.language → 语言码（严格归一：非 "en" 一律 "zh"）。
 * 此前 API 层散布两种口径：`=== "en" ? "en" : "zh"`（严格）与 `|| "zh"`（宽松透传，
 * 非法值会原样漏到 prompt 层）。R4 重复维 L2 收敛为本函数，统一严格口径。
 */
export function resolveLang(settings: { app?: { language?: string } } | null | undefined): "zh" | "en" {
  return settings?.app?.language === "en" ? "en" : "zh";
}
