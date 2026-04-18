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

export async function getProject(auPath: string) {
  const { project } = getEngine().repos;
  return await project.get(auPath);
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
