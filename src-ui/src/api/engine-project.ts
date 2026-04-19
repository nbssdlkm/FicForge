// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Project query/command layer.
 *
 * Project writes are read-modify-write operations over `project.yaml`,
 * so every mutating command must stay serialized behind the AU lock.
 */

import type { Project } from "@ficforge/engine";
import { withAuLock } from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import type { ModelParamInfo } from "./settings";
import type {
  AuSettingsSaveInput,
  ProjectCapabilities,
  ProjectLlmQueryInfo,
  WorkspaceSnapshot,
  WriterProjectContext,
} from "./project";

async function withProjectWrite<T>(auPath: string, mutate: (current: Project) => T | Promise<T>): Promise<T> {
  const { project } = getEngine().repos;
  return withAuLock(auPath, async () => {
    const current = await project.get(auPath);
    const result = await mutate(current);
    await project.save(current);
    return result;
  });
}

async function readProject(auPath: string): Promise<Project> {
  const { project } = getEngine().repos;
  return project.get(auPath);
}

function hasProjectLlmOverride(llm: Project["llm"] | null | undefined): boolean {
  return Boolean(
    llm && (
      llm.mode !== "api"
      || llm.model
      || llm.api_base
      || llm.api_key
      || llm.local_model_path
      || llm.ollama_model
    )
  );
}

function toProjectLlmQueryInfo(llm: Project["llm"] | null | undefined): ProjectLlmQueryInfo {
  return {
    mode: llm?.mode || "api",
    model: llm?.model || "",
    api_base: llm?.api_base || "",
    has_api_key: Boolean(llm?.api_key?.trim()),
    local_model_path: llm?.local_model_path || "",
    ollama_model: llm?.ollama_model || "",
    context_window: llm?.context_window || 0,
    has_override: hasProjectLlmOverride(llm),
  };
}

function toModelParamInfoMap(source: Record<string, Record<string, unknown>> | undefined): Record<string, ModelParamInfo> {
  if (!source) return {};
  const result: Record<string, ModelParamInfo> = {};
  for (const [model, value] of Object.entries(source)) {
    result[model] = {
      temperature: typeof value.temperature === "number" ? value.temperature : 1.0,
      top_p: typeof value.top_p === "number" ? value.top_p : 0.95,
    };
  }
  return result;
}

export async function getProjectForEditing(auPath: string) {
  return readProject(auPath);
}

export async function getProjectCapabilities(_auPath: string): Promise<ProjectCapabilities> {
  return {
    secret_storage: getEngine().adapter.getSecretStorageCapabilities(),
  };
}

export async function getWorkspaceSnapshot(auPath: string): Promise<WorkspaceSnapshot> {
  const project = await readProject(auPath);
  return {
    pinned_count: project.pinned_context.length,
  };
}

export async function getWriterProjectContext(auPath: string): Promise<WriterProjectContext> {
  const project = await readProject(auPath);
  return {
    llm: toProjectLlmQueryInfo(project.llm),
    model_params_override: toModelParamInfoMap(project.model_params_override),
  };
}

export async function saveProjectCastRegistryCharacters(auPath: string, characters: string[]) {
  return withProjectWrite(auPath, (current) => {
    current.cast_registry = { characters } as Project["cast_registry"];
    return current.cast_registry;
  });
}

export async function saveProjectCoreIncludes(auPath: string, coreAlwaysInclude: string[]) {
  return withProjectWrite(auPath, (current) => {
    current.core_always_include = [...coreAlwaysInclude];
    return current.core_always_include;
  });
}

export async function saveProjectWritingStyle(auPath: string, writingStyle: Project["writing_style"]) {
  return withProjectWrite(auPath, (current) => {
    current.writing_style = writingStyle;
    return current.writing_style;
  });
}

export async function saveProjectCastRegistryAndCoreIncludes(
  auPath: string,
  payload: { characters: string[]; core_always_include: string[] },
) {
  return withProjectWrite(auPath, (current) => {
    current.cast_registry = { characters: payload.characters } as Project["cast_registry"];
    current.core_always_include = [...payload.core_always_include];
    return {
      cast_registry: current.cast_registry,
      core_always_include: current.core_always_include,
    };
  });
}

export async function saveAuSettingsForEditing(auPath: string, payload: AuSettingsSaveInput) {
  return withProjectWrite(auPath, (current) => {
    current.chapter_length = payload.chapter_length;
    current.writing_style = {
      ...(current.writing_style || {}),
      perspective: payload.writing_style.perspective as Project["writing_style"]["perspective"],
      emotion_style: payload.writing_style.emotion_style as Project["writing_style"]["emotion_style"],
      custom_instructions: payload.writing_style.custom_instructions,
    };
    current.pinned_context = [...payload.pinned_context];
    current.core_always_include = [...payload.core_always_include];

    current.embedding_lock = payload.embedding_override.enabled
      ? {
          mode: payload.embedding_override.model ? "api" : "",
          model: payload.embedding_override.model,
          api_base: payload.embedding_override.api_base,
          api_key: payload.embedding_override.api_key,
        } as Project["embedding_lock"]
      : {
          mode: "",
          model: "",
          api_base: "",
          api_key: "",
        } as Project["embedding_lock"];

    current.llm = payload.llm_override.enabled
      ? {
          mode: payload.llm_override.mode as Project["llm"]["mode"],
          model: payload.llm_override.mode === "api" ? payload.llm_override.model : "",
          api_base: payload.llm_override.mode === "ollama"
            ? (payload.llm_override.api_base || "http://localhost:11434/v1")
            : payload.llm_override.api_base,
          api_key: payload.llm_override.mode === "api" ? payload.llm_override.api_key : "",
          local_model_path: payload.llm_override.mode === "local" ? payload.llm_override.local_model_path : "",
          ollama_model: payload.llm_override.mode === "ollama" ? payload.llm_override.ollama_model : "",
          context_window: payload.llm_override.context_window,
        } as Project["llm"]
      : {
          mode: "api",
          model: "",
          api_base: "",
          api_key: "",
          local_model_path: "",
          ollama_model: "",
          context_window: 0,
        } as Project["llm"];

    return current;
  });
}

export async function saveProjectModelParamsOverride(auPath: string, model: string, params: ModelParamInfo) {
  return withProjectWrite(auPath, (current) => {
    current.model_params_override = current.model_params_override || {};
    current.model_params_override[model] = {
      temperature: params.temperature,
      top_p: params.top_p,
    };
    return current.model_params_override[model];
  });
}

export async function addPinned(auPath: string, text: string) {
  const { project } = getEngine().repos;
  return withAuLock(auPath, async () => {
    const proj = await project.get(auPath);
    proj.pinned_context.push(text);
    await project.save(proj);
    return { status: "ok", revision: proj.revision };
  });
}

export async function deletePinned(auPath: string, index: number) {
  const { project } = getEngine().repos;
  return withAuLock(auPath, async () => {
    const proj = await project.get(auPath);
    if (index >= 0 && index < proj.pinned_context.length) {
      proj.pinned_context.splice(index, 1);
      await project.save(proj);
    }
    return { status: "ok", revision: proj.revision };
  });
}
