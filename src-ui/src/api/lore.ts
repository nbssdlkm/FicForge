// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** Lore API — Read and write markdown files for Fandom and AU */

export interface LoreSaveRequest {
  au_path?: string;
  fandom_path?: string;
  category: string;
  filename: string;
  content: string;
}

export interface LoreReadRequest {
  au_path?: string;
  fandom_path?: string;
  category: string;
  filename: string;
}
