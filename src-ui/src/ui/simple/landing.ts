// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * AU 默认 landing page 决策（运行时 writing_mode 版）。
 *
 * simple 模式进 AU 默认落「对话」面板；full 模式落「续写」(writer)。
 * 调用方传入 LIVE 模式（`useWritingMode().mode`），见 Phase 2 spec §3.4 —
 * 所有 `onNavigate('writer', auPath)` 入口站点改成 `onNavigate(getAuLandingPage(mode), auPath)`。
 *
 * full 默认零回归：getSimpleFeatures('full').simpleAssembler === false → 'writer'。
 */

import { getSimpleFeatures, type WritingMode } from "@ficforge/engine";

export type AuLandingPage = "chat" | "writer";

export function getAuLandingPage(mode: WritingMode): AuLandingPage {
  return getSimpleFeatures(mode).simpleAssembler ? "chat" : "writer";
}
