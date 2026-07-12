// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Search, Check } from "lucide-react";
import { Spinner } from "../shared/Spinner";
import { Button } from "../shared/Button";
import { ChipListInput } from "../shared/ChipListInput";
import { Input, Textarea } from "../shared/Input";
import { EmptyState } from "../shared/EmptyState";
import { FactThreadsSection } from "../threads/FactThreadsSection";
import { useTranslation } from "../../i18n/useAppTranslation";
import { getEnumLabel } from "../../i18n/labels";
import { NARRATIVE_WEIGHT_VALUES } from "@ficforge/engine";
import type { useFactEditor } from "./useFactEditor";

/**
 * FactEditorForm — 单条事实笔记的编辑表单（拆自 FactsLayout.renderFactEditor）。
 *
 * 桌面右栏内联渲染（showFooter=false，保存按钮在页头）；移动端塞进编辑弹窗
 *（showFooter=true，底部带保存/取消）。行为逐字保持，仅把闭包变量提为 props。
 */
export interface FactEditorFormProps {
  editor: ReturnType<typeof useFactEditor>;
  auPath: string;
  /** 知情名单联想：本条涉及角色优先 + 全库出现过的角色名（datalist）。 */
  knowledgeNameSuggestions: string[];
  /** true 时渲染底部保存/取消（移动端弹窗）；false 时保存按钮在外层页头（桌面）。 */
  showFooter: boolean;
  /** 状态下拉切换（原 handleStatusChange）。 */
  onStatusChange: (factId: string, nextStatus: string) => void;
  /** 取消归档（原 handleUnarchive）。 */
  onUnarchive: (factId: string) => void;
}

export function FactEditorForm({
  editor,
  auPath,
  knowledgeNameSuggestions,
  showFooter,
  onStatusChange,
  onUnarchive,
}: FactEditorFormProps) {
  const { t } = useTranslation();

  if (!editor.editingFact) {
    return (
      <EmptyState
        icon={<Search size={40} />}
        title={t("facts.emptySelectionTitle")}
        description={t("facts.emptySelectionDescription")}
      />
    );
  }

  return (
    <div key={editor.editingFact.id} className="space-y-6">
      {editor.editingFact.archived && (
        <div className="flex flex-col gap-2 rounded-lg border border-black/10 bg-surface/60 px-4 py-3 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-text/70">{t("facts.archivedHint")}</span>
          <Button tone="neutral" fill="outline" size="sm" onClick={() => onUnarchive(editor.editingFact!.id)}>
            {t("facts.unarchive")}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold text-text/90">{t("common.labels.factStatus")}</label>
          <select
            className="h-11 rounded-md border border-black/20 bg-surface px-3 text-base outline-hidden focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:text-sm"
            value={editor.editingFact.status}
            onChange={(e) => onStatusChange(editor.editingFact!.id, e.target.value)}
          >
            <option value="unresolved">{getEnumLabel("fact_status", "unresolved", "unresolved")}</option>
            <option value="active">{getEnumLabel("fact_status", "active", "active")}</option>
            <option value="resolved">{getEnumLabel("fact_status", "resolved", "resolved")}</option>
            <option value="deprecated">{getEnumLabel("fact_status", "deprecated", "deprecated")}</option>
          </select>
          <p className="text-xs text-text/50">{t("facts.statusHintResolved")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold text-text/90">{t("common.labels.narrativeWeight")}</label>
          <select
            ref={editor.editWeightRef}
            defaultValue={editor.editingFact.narrative_weight || "medium"}
            className="h-11 rounded-md border border-black/20 bg-surface px-3 text-base outline-hidden focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:text-sm"
          >
            {NARRATIVE_WEIGHT_VALUES.map((w) => (
              <option key={w} value={w}>
                {getEnumLabel("narrative_weight", w, w)}
              </option>
            ))}
          </select>
          <p className="text-xs text-text/50">{t("facts.weightHint")}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-text/90">{t("common.labels.contentClean")}</label>
        <Textarea
          ref={editor.editContentCleanRef}
          defaultValue={editor.editingFact.content_clean}
          className="font-serif min-h-[160px] text-lg leading-relaxed resize-y"
        />
        <p className="text-xs text-text/50">{t("facts.cleanHint")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-text/90">{t("common.labels.contentRaw")}</label>
        <Textarea
          ref={editor.editContentRawRef}
          defaultValue={editor.editingFact.content_raw}
          className="font-serif opacity-70 min-h-[140px] text-base leading-relaxed bg-surface/50 resize-y"
        />
        <p className="text-xs text-text/50">{t("facts.rawHint")}</p>
      </div>

      <div className="flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/10">
        <label className="text-sm font-bold text-text/90">{t("common.labels.characters")}</label>
        <Input
          ref={editor.editCharactersRef}
          defaultValue={(editor.editingFact.characters || []).join(", ")}
          className="h-11 text-base md:h-10 md:text-sm"
        />
        <p className="text-xs text-text/50">{t("facts.charactersHint")}</p>
      </div>

      {/* 知情范围（M3 批一）：谁知道 / 瞒着谁 —— AI 标注在此可改，人改后必然生效（引擎自动升置信）。
          联想名单 = 本条涉及角色优先 + 全库出现过的角色名（datalist）。 */}
      <div className="flex flex-col gap-4 border-t border-black/10 pt-4 dark:border-white/10">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold text-text/90">{t("facts.knowledge.knownToLabel")}</label>
          <select
            value={editor.knownToMode}
            onChange={(e) => editor.selectKnownToMode(e.target.value as "unset" | "all" | "reader_only" | "some")}
            className="h-11 rounded-md border border-black/20 bg-surface px-3 text-base outline-hidden focus:ring-2 focus:ring-accent dark:border-white/20 md:h-10 md:text-sm"
          >
            <option value="unset">{t("facts.knowledge.knownToUnset")}</option>
            <option value="all">{getEnumLabel("known_to", "all", "all")}</option>
            <option value="reader_only">{getEnumLabel("known_to", "reader_only", "reader_only")}</option>
            <option value="some">{t("facts.knowledge.knownToSomeOption")}</option>
          </select>
          {editor.knownToMode === "some" && (
            <ChipListInput
              label={t("facts.knowledge.knownToLabel")}
              values={editor.knownToNames}
              inputValue={editor.knownToDraft}
              onInputChange={editor.setKnownToDraft}
              onCommit={editor.commitKnownToName}
              onRemoveAt={editor.removeKnownToNameAt}
              onPopLast={editor.popLastKnownToName}
              placeholder={t("facts.knowledge.namesPlaceholder")}
              suggestions={knowledgeNameSuggestions}
              suggestionsId="fact-knowledge-names"
            />
          )}
          <p className="text-xs text-text/50">{t("facts.knowledge.knownToHint")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold text-text/90">{t("facts.knowledge.hiddenFromLabel")}</label>
          <ChipListInput
            label={t("facts.knowledge.hiddenFromLabel")}
            values={editor.hiddenFromNames}
            inputValue={editor.hiddenFromDraft}
            onInputChange={editor.setHiddenFromDraft}
            onCommit={editor.commitHiddenFromName}
            onRemoveAt={editor.removeHiddenFromNameAt}
            onPopLast={editor.popLastHiddenFromName}
            placeholder={t("facts.knowledge.namesPlaceholder")}
            suggestions={knowledgeNameSuggestions}
            suggestionsId="fact-knowledge-names-hidden"
          />
          <p className="text-xs text-text/50">{t("facts.knowledge.hiddenFromHint")}</p>
        </div>
      </div>

      {/* Fact 反向视图（M8-B）：这条笔记归入哪些剧情线 + 各线里的角色（只读，挂线在 ThreadDetail 做） */}
      <FactThreadsSection
        auPath={auPath}
        threadIds={editor.editingFact.thread_ids}
        threadRoles={editor.editingFact.thread_roles}
      />

      {showFooter ? (
        <div className="flex items-center justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
          <Button tone="neutral" fill="plain" onClick={() => editor.closeEditFact()}>
            {t("facts.cancelSelection")}
          </Button>
          <Button tone="accent" fill="solid" onClick={editor.handleSaveFact} disabled={editor.savingFact}>
            {editor.savingFact ? (
              <Spinner size="sm" />
            ) : editor.saveSuccess ? (
              <>
                <Check size={14} className="mr-1" /> {t("facts.saved")}
              </>
            ) : (
              t("common.actions.save")
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
