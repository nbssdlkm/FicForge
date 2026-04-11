// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** Facts API */

export interface FactInfo {
  id: string;
  content_raw: string;
  content_clean: string;
  characters: string[];
  status: string;
  type: string;
  narrative_weight: string;
  chapter: number;
  timeline: string;
}

export interface ExtractedFactCandidate {
  content_raw: string;
  content_clean: string;
  characters: string[];
  fact_type?: string;
  type?: string;
  narrative_weight: string;
  status: string;
  chapter: number;
  timeline?: string;
}

export interface ExtractFactsResponse {
  facts: ExtractedFactCandidate[];
}
