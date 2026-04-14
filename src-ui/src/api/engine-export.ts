// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Export — exportChapters, importChaptersFromText.
 */

import { export_chapters as engineExportChapters } from "@ficforge/engine";
import { getEngine } from "./engine-client";

export async function exportChapters(params: {
  au_path: string;
  format?: string;
  start_chapter?: number;
  end_chapter?: number;
  include_title?: boolean;
}) {
  const { chapter, state, project } = getEngine().repos;
  const [st, proj] = await Promise.all([
    state.get(params.au_path),
    project.get(params.au_path),
  ]);
  const text = await engineExportChapters({
    au_id: params.au_path,
    chapter_repo: chapter,
    format: (params.format ?? "txt") as "txt" | "md",
    start_chapter: params.start_chapter,
    end_chapter: params.end_chapter,
    chapter_titles: st.chapter_titles,
  });
  const blob = new Blob([text], { type: "text/plain" });
  const ext = params.format ?? "txt";
  const safeName = (proj.name || "export").replace(/[<>:"/\\|?*]/g, "_");
  const filename = `${safeName}.${ext}`;
  return { blob, filename };
}

export async function importChaptersFromText(auPath: string, text: string, splitMethod?: string) {
  const { split_into_chapters, import_chapters } = await import("@ficforge/engine");
  const chapters = split_into_chapters(text);
  const { chapter, state, ops } = getEngine().repos;
  return await import_chapters({
    au_id: auPath,
    chapters,
    chapter_repo: chapter,
    state_repo: state,
    ops_repo: ops,
    split_method: splitMethod,
  });
}
