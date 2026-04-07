// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** Project API — AU-specific configuration */

import { apiFetch } from "./client";

export interface WritingStyle {
  perspective: string;
  pov_character: string;
  emotion_style: string;
  custom_instructions: string;
}

export interface CastRegistry {
  characters: string[];
}

export interface EmbeddingLock {
  mode: string;
  model: string;
  api_base: string;
  api_key: string;
}

export interface ProjectInfo {
  project_id: string;
  au_id: string;
  name: string;
  fandom: string;
  schema_version: string;
  revision: number;
  created_at: string;
  updated_at: string;
  llm: {
    mode: string;
    model: string;
    api_base: string;
    api_key: string;
    local_model_path: string;
    ollama_model: string;
    context_window: number;
  };
  model_params_override: Record<string, { temperature: number; top_p: number }>;
  chapter_length: number;
  writing_style: WritingStyle;
  ignore_core_worldbuilding: boolean;
  agent_pipeline_enabled: boolean;
  cast_registry: CastRegistry;
  core_always_include: string[];
  pinned_context: string[];
  rag_decay_coefficient: number;
  embedding_lock: EmbeddingLock;
  core_guarantee_budget: number;
  current_branch: string;
}

export async function getProject(auPath: string): Promise<ProjectInfo> {
  return apiFetch(`/api/v1/project?au_path=${encodeURIComponent(auPath)}`);
}

export async function updateProject(auPath: string, updates: any): Promise<any> {
  return apiFetch(`/api/v1/project?au_path=${encodeURIComponent(auPath)}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function addPinned(auPath: string, text: string): Promise<{ status: string; revision: number }> {
  return apiFetch(`/api/v1/project/pinned?au_path=${encodeURIComponent(auPath)}`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function deletePinned(auPath: string, index: number): Promise<{ status: string; revision: number }> {
  return apiFetch(`/api/v1/project/pinned/${index}?au_path=${encodeURIComponent(auPath)}`, {
    method: "DELETE",
  });
}
