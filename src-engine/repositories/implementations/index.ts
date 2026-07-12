// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Repository 文件 I/O 实现导出。 */

export { FileChapterRepository } from "./file_chapter.js";
export { FileChapterSummaryRepository, summaryPath } from "./file_chapter_summary.js";
export { FileDraftRepository } from "./file_draft.js";
export { FileFactRepository } from "./file_fact.js";
export { FileFandomRepository } from "./file_fandom.js";
export { FileOpsRepository } from "./file_ops.js";
export { FileProjectRepository } from "./file_project.js";
export { customProviderApiKeySecureKey, FileSettingsRepository } from "./file_settings.js";
export { FileSimpleChatRepository } from "./file_simple_chat.js";
export { FileStateRepository } from "./file_state.js";
export { FileThreadRepository, threadToDict } from "./file_thread.js";

// Utilities
export {
  computeContentHash,
  generateFactId,
  generateOpId,
  generateThreadId,
  nowUtc,
} from "../../utils/file_utils.js";
