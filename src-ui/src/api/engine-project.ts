// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Project — getProject, updateProject, addPinned, deletePinned.
 *
 * AU 锁：三个写入函数都是"读-改-写 project.yaml"的 RMW 模式。并发两次
 * addPinned 会互相覆盖（后写者只看到写入前的 pinned_context），必须串行化。
 */

import type { Project } from "@ficforge/engine";
import { withAuLock } from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import type { ModelParamInfo } from "./settings";
import type { ProjectLlmQueryInfo, WorkspaceSnapshot, WriterProjectContext } from "./project";

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

export async function getProject(auPath: string) {
  const { project } = getEngine().repos;
  return await project.get(auPath);
}

export async function getProjectForEditing(auPath: string) {
  return getProject(auPath);
}

export async function getWorkspaceSnapshot(auPath: string): Promise<WorkspaceSnapshot> {
  const project = await getProject(auPath);
  return {
    pinned_count: project.pinned_context.length,
  };
}

export async function getWriterProjectContext(auPath: string): Promise<WriterProjectContext> {
  const project = await getProject(auPath);
  return {
    llm: toProjectLlmQueryInfo(project.llm),
    model_params_override: toModelParamInfoMap(project.model_params_override),
  };
}

export async function updateProject(auPath: string, updates: Partial<Project> | Record<string, unknown>) {
  const { project } = getEngine().repos;
  return withAuLock(auPath, async () => {
    const current = await project.get(auPath);
    Object.assign(current, updates);
    await project.save(current);
    return current;
  });
}

export async function saveProjectModelParamsOverride(auPath: string, model: string, params: ModelParamInfo) {
  const { project } = getEngine().repos;
  return withAuLock(auPath, async () => {
    const current = await project.get(auPath);
    current.model_params_override = current.model_params_override || {};
    current.model_params_override[model] = {
      temperature: params.temperature,
      top_p: params.top_p,
    };
    await project.save(current);
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
