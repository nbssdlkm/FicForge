// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useId } from "react";
import { Spinner } from "../shared/Spinner";
import { Button } from "../shared/Button";
import { Input, Textarea } from "../shared/Input";
import { Modal } from "../shared/Modal";
import { ExtractReviewModal } from "../writer/WriterModals";
import { useTranslation } from "../../i18n/useAppTranslation";
import { getEnumLabel } from "../../i18n/labels";
import { NARRATIVE_WEIGHT_VALUES } from "@ficforge/engine";
import { FactEditorForm } from "./FactEditorForm";
import type { useFactEditor } from "./useFactEditor";
import type { useBatchFacts } from "./useBatchFacts";
import type { useFactsExtraction } from "./useFactsExtraction";

/**
 * FactsModals — 事实笔记页共享弹窗区（拆自 FactsLayout.sharedModals）。
 *
 * 移动端编辑弹窗 / 新建弹窗 / 提取范围弹窗 / 提取审阅弹窗 / 批量确认弹窗。桌面与移动端
 * 布局都在末尾挂一份本组件（单实例，isMobile 只控制是否渲染移动端编辑弹窗）。行为逐字保持。
 */
export interface FactsModalsProps {
  isMobile: boolean;
  editor: ReturnType<typeof useFactEditor>;
  extraction: ReturnType<typeof useFactsExtraction>;
  batch: ReturnType<typeof useBatchFacts>;
  auPath: string;
  knowledgeNameSuggestions: string[];
  onStatusChange: (factId: string, nextStatus: string) => void;
  onUnarchive: (factId: string) => void;
}

export function FactsModals({
  isMobile,
  editor,
  extraction,
  batch,
  auPath,
  knowledgeNameSuggestions,
  onStatusChange,
  onUnarchive,
}: FactsModalsProps) {
  const { t } = useTranslation();
  const newTypeId = useId();
  const newWeightId = useId();
  const newStatusId = useId();
  const extractFromId = useId();
  const extractToId = useId();

  return (
    <>
      {isMobile ? (
        <Modal
          isOpen={!!editor.editingFact}
          onClose={editor.savingFact ? () => {} : () => editor.closeEditFact()}
          title={
            editor.editingFact ? `${editor.editingFact.id.split("-")[0]} ${t("facts.editing")}` : t("facts.editing")
          }
        >
          <FactEditorForm
            editor={editor}
            auPath={auPath}
            knowledgeNameSuggestions={knowledgeNameSuggestions}
            showFooter={true}
            onStatusChange={onStatusChange}
            onUnarchive={onUnarchive}
          />
        </Modal>
      ) : null}

      <Modal
        isOpen={editor.isAddModalOpen}
        onClose={editor.adding ? () => {} : () => editor.closeAddModal()}
        title={t("facts.createModal.title")}
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <Textarea
              label={t("common.labels.contentRaw")}
              value={editor.newContentRaw}
              onChange={(e) => editor.setNewContentRaw(e.target.value)}
              placeholder={t("facts.createModal.rawPlaceholder")}
              className="min-h-[80px] bg-surface/50"
            />
            <p className="text-xs text-text/50">{t("facts.rawHint")}</p>
          </div>
          <div className="space-y-1">
            <Textarea
              label={`${t("common.labels.contentClean")} *`}
              value={editor.newContentClean}
              onChange={(e) => editor.setNewContentClean(e.target.value)}
              placeholder={t("facts.createModal.cleanPlaceholder")}
              className="min-h-[80px] bg-surface/50 font-bold"
            />
            <p className="text-xs text-text/50">{t("facts.cleanHint")}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={newTypeId} className="mb-1 block text-xs font-bold text-text/90">
                {t("facts.createModal.typeLabel")}
              </label>
              <select
                id={newTypeId}
                value={editor.newType}
                onChange={(e) => editor.setNewType(e.target.value)}
                className="h-11 w-full rounded-md border border-black/10 bg-surface px-2 text-base dark:border-white/10 md:h-9 md:text-sm"
              >
                <option value="plot_event">{getEnumLabel("fact_type", "plot_event", "plot_event")}</option>
                <option value="character_detail">
                  {getEnumLabel("fact_type", "character_detail", "character_detail")}
                </option>
                <option value="relationship">{getEnumLabel("fact_type", "relationship", "relationship")}</option>
                <option value="backstory">{getEnumLabel("fact_type", "backstory", "backstory")}</option>
                <option value="foreshadowing">{getEnumLabel("fact_type", "foreshadowing", "foreshadowing")}</option>
                <option value="world_rule">{getEnumLabel("fact_type", "world_rule", "world_rule")}</option>
              </select>
            </div>
            <div>
              <label htmlFor={newWeightId} className="mb-1 block text-xs font-bold text-text/90">
                {t("facts.createModal.weightLabel")}
              </label>
              <select
                id={newWeightId}
                value={editor.newWeight}
                onChange={(e) => editor.setNewWeight(e.target.value)}
                className="h-11 w-full rounded-md border border-black/10 bg-surface px-2 text-base dark:border-white/10 md:h-9 md:text-sm"
              >
                {NARRATIVE_WEIGHT_VALUES.map((w) => (
                  <option key={w} value={w}>
                    {getEnumLabel("narrative_weight", w, w)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={newStatusId} className="mb-1 block text-xs font-bold text-text/90">
                {t("facts.createModal.statusLabel")}
              </label>
              <select
                id={newStatusId}
                value={editor.newStatus}
                onChange={(e) => editor.setNewStatus(e.target.value)}
                className="h-11 w-full rounded-md border border-black/10 bg-surface px-2 text-base dark:border-white/10 md:h-9 md:text-sm"
              >
                <option value="active">{getEnumLabel("fact_status", "active", "active")}</option>
                <option value="unresolved">{getEnumLabel("fact_status", "unresolved", "unresolved")}</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <Button tone="neutral" fill="plain" onClick={() => editor.closeAddModal()} disabled={editor.adding}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              tone="accent"
              fill="solid"
              onClick={editor.handleAddFact}
              disabled={!editor.newContentClean.trim() || editor.adding}
            >
              {editor.adding ? <Spinner size="md" /> : t("facts.createModal.submit")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={extraction.extractRangeOpen}
        onClose={() => extraction.closeExtractRange()}
        title={t("facts.extractRangeTitle")}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/70">{t("facts.extractRangeDesc")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto,96px,auto,96px,1fr] sm:items-center">
            <label htmlFor={extractFromId} className="text-sm text-text/70 shrink-0">
              {t("facts.extractFrom")}
            </label>
            <Input
              id={extractFromId}
              type="number"
              className="h-11 text-base md:h-8 md:text-sm"
              min={1}
              max={extraction.extractRange[1]}
              value={extraction.extractRange[0]}
              onChange={(e) =>
                extraction.setExtractRange([Math.max(1, parseInt(e.target.value) || 1), extraction.extractRange[1]])
              }
            />
            <label htmlFor={extractToId} className="text-sm text-text/70 shrink-0">
              {t("facts.extractTo")}
            </label>
            <Input
              id={extractToId}
              type="number"
              className="h-11 text-base md:h-8 md:text-sm"
              min={extraction.extractRange[0]}
              value={extraction.extractRange[1]}
              onChange={(e) =>
                extraction.setExtractRange([
                  extraction.extractRange[0],
                  parseInt(e.target.value) || extraction.extractRange[1],
                ])
              }
            />
            <span className="text-xs text-text/50">
              {t("facts.extractChapterCount", { count: extraction.extractRange[1] - extraction.extractRange[0] + 1 })}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Button tone="neutral" fill="plain" onClick={() => extraction.closeExtractRange()}>
              {t("common.actions.cancel")}
            </Button>
            <Button tone="accent" fill="solid" onClick={extraction.handleExtractConfirm}>
              {t("facts.extractStart")}
            </Button>
          </div>
        </div>
      </Modal>

      <ExtractReviewModal
        isOpen={extraction.extractModalOpen}
        onClose={extraction.savingExtraction ? () => {} : () => extraction.closeExtractModal()}
        extractedCandidates={extraction.extractedCandidates}
        selectedExtractedKeys={extraction.selectedExtractedKeys}
        getCandidateKey={extraction.getCandidateKey}
        onToggleCandidate={extraction.toggleExtractedCandidate}
        onSave={extraction.handleSaveExtracted}
        savingExtracted={extraction.savingExtraction}
      />

      <Modal
        isOpen={!!batch.batchConfirm}
        onClose={batch.batchProcessing ? () => {} : () => batch.setBatchConfirm(null)}
        title={t("facts.batchConfirmTitle", {
          count: batch.selectedIds.size,
          status: batch.batchConfirm ? getEnumLabel("fact_status", batch.batchConfirm, batch.batchConfirm) : "",
        })}
      >
        <div className="space-y-4">
          <p className="text-sm text-text/70">
            {batch.batchConfirm === "deprecated" && t("facts.batchDeprecatedDesc")}
            {batch.batchConfirm === "resolved" && t("facts.batchResolvedDesc")}
            {batch.batchConfirm === "active" && t("facts.batchActiveDesc")}
            {batch.batchConfirm === "unresolved" && t("facts.batchUnresolvedDesc")}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              tone="neutral"
              fill="plain"
              onClick={() => batch.setBatchConfirm(null)}
              disabled={batch.batchProcessing}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              tone="accent"
              fill="solid"
              onClick={() => batch.batchConfirm && batch.handleBatchStatus(batch.batchConfirm)}
              disabled={batch.batchProcessing}
            >
              {batch.batchProcessing ? <Spinner size="sm" /> : t("common.actions.confirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
