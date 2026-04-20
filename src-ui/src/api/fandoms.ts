// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** Fandom / AU API */

export interface AuInfo {
  name: string;
  dir_name: string;
}

export interface FandomInfo {
  name: string;
  dir_name: string;
  aus: AuInfo[];
}

export interface FandomDisplayInfo {
  name: string;
  dir_name: string;
  path: string;
}

export interface FandomFileEntry {
  name: string;
  filename: string;
}

export interface FandomFilesResponse {
  characters: FandomFileEntry[];
  worldbuilding: FandomFileEntry[];
}
