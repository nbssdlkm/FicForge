// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 批注领域对象（FIX-005B）。 */

export const ANNOTATION_SCHEMA_VERSION = "1.0.0";

export interface Annotation {
  id: string;                                          // "ann_" + 6位随机ID
  type: "highlight" | "comment" | "bookmark";
  start_offset: number;                                // 正文中的起始字符偏移
  end_offset: number;                                  // 结束字符偏移
  color: string;                                       // highlight 颜色
  comment: string;                                     // comment 类型时的文字内容
  created_at: string;                                  // ISO 8601
}

export interface ChapterAnnotations {
  schema_version: string;
  chapter_num: number;
  annotations: Annotation[];
}

export function createAnnotation(partial: Pick<Annotation, "id" | "type" | "start_offset" | "end_offset"> & Partial<Annotation>): Annotation {
  return {
    color: "yellow",
    comment: "",
    created_at: "",
    ...partial,
  };
}

export function createChapterAnnotations(partial?: Partial<ChapterAnnotations>): ChapterAnnotations {
  return {
    schema_version: ANNOTATION_SCHEMA_VERSION,
    chapter_num: 0,
    annotations: [],
    ...partial,
  };
}
