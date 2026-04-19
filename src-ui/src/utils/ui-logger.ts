// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { logCatch } from "../api/engine-client";

export function logUiError(tag: string, message: string, error?: unknown): void {
  logCatch(tag, message, error);
}
