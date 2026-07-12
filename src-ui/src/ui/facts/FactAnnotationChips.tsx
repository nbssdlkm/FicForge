// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Tag } from "../shared/Tag";
import { getKnownToLabel, getHiddenFromLabel } from "../../i18n/labels";
import { useTranslation } from "../../i18n/useAppTranslation";

/** Fact 与 ExtractedFactCandidate 都天然满足的最小结构（结构化 props，两种输入通吃）。 */
export type FactAnnotationSource = {
  known_to?: "all" | "reader_only" | string[] | null;
  hidden_from?: string[] | null;
  story_time_tag?: string | null;
};

/**
 * 知情标注 chips —— 剧情笔记卡片 / 提取确认卡 / 脏章候选卡共用（M3 批一，单一真相源）。
 * 展示口径与引擎注入端一致：known_to 为 all/null/空名单、hidden_from 为空时不出章，
 * 避免每张卡都长一排无信息量徽章。story_time_tag 为批三预留位（showStoryTimeTag 开启）。
 */
export function FactAnnotationChips({
  fact,
  showStoryTimeTag = false,
}: {
  fact: FactAnnotationSource;
  showStoryTimeTag?: boolean;
}) {
  const { t } = useTranslation();
  const knownTo = getKnownToLabel(fact.known_to);
  const hiddenFrom = getHiddenFromLabel(fact.hidden_from);
  const storyTimeTag =
    showStoryTimeTag && typeof fact.story_time_tag === "string" && fact.story_time_tag.trim() !== ""
      ? fact.story_time_tag.trim()
      : "";
  if (!knownTo && !hiddenFrom && !storyTimeTag) return null;
  return (
    <>
      {knownTo && (
        <Tag tone="info" title={t("facts.knowledge.chipHint")}>
          {knownTo}
        </Tag>
      )}
      {hiddenFrom && (
        <Tag tone="warning" title={t("facts.knowledge.chipHint")}>
          {hiddenFrom}
        </Tag>
      )}
      {storyTimeTag && <Tag tone="default">{storyTimeTag}</Tag>}
    </>
  );
}
