// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Check } from "lucide-react";
import { Spinner } from "../shared/Spinner";
import { Button } from "../shared/Button";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { updateFactStatus, unarchiveFact, type FactStatus } from "../../api/engine-client";
import { useTranslation } from "../../i18n/useAppTranslation";
import { useFeedback } from "../../hooks/useFeedback";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useFactsData } from "./useFactsData";
import { useFactsFilter } from "./useFactsFilter";
import { useBatchFacts } from "./useBatchFacts";
import { useFactEditor } from "./useFactEditor";
import { useFactsExtraction } from "./useFactsExtraction";
import { FactsFilterBar, type FactsCounts } from "./FactsFilterBar";
import { FactsListControls } from "./FactsListControls";
import { FactsList } from "./FactsList";
import { FactsModals } from "./FactsModals";
import { FactEditorForm } from "./FactEditorForm";

/**
 * FactsLayout — 事实笔记页编排壳（长期债②：896 行 god 组件拆分）。
 *
 * 数据下沉 useFactsData；渲染拆到 FactsFilterBar（筛选栏）/ FactsListControls（提取/过期/批量条）/
 * FactsList（列表）/ FactsModals + FactEditorForm（弹窗区）。本文件只留：hook 编排、跨 hook reset、
 * 加载触发、mutation 处理器（状态切换 / 取消归档）与派生量（计数 / 空态 / 过期 / 知情联想）。
 */
export const FactsLayout = ({ auPath }: { auPath: string }) => {
  const { t } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const isMobile = useMediaQuery("(max-width: 768px)");
  // 供 mutation 处理器 await 后判用户是否已切走（与 useFactsData 内部 loadGuard 各自守卫，
  // 二者都 key 在 auPath 上，isKeyStale 判定一致）。
  const loadGuard = useActiveRequestGuard(auPath);

  const data = useFactsData(auPath);
  const factsFilter = useFactsFilter(data.facts, data.state);

  // reloadFacts：稳定引用（per-auPath），mutation 成功后由 sub-hook 调；重拉时读「当前 statusFilter」。
  // statusFilter 属 factsFilter（又依赖 data.facts，构成环），故不入参绑定，用 ref 桥接最新值。
  const statusFilterRef = useRef(factsFilter.statusFilter);
  statusFilterRef.current = factsFilter.statusFilter;
  const reloadFacts = useCallback(() => data.loadFacts(statusFilterRef.current), [data.loadFacts]);

  const batch = useBatchFacts(auPath, factsFilter.filteredFacts, reloadFacts);
  const editor = useFactEditor(auPath, data.state?.current_chapter ?? 1, reloadFacts);
  const extraction = useFactsExtraction(auPath, data.state, reloadFacts);

  // 跨 hook reset：本组件负责 reset 不自 reset 的 hook —— factsFilter 不吃 auPath、editor 显式关弹窗。
  // data 的显示数据由 useFactsData 内部 auPath effect 自 reset（铁律 2）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只应随 auPath 复位（factsFilter/editor 引用稳定，有意省略）
  useEffect(() => {
    factsFilter.resetFilters();
    editor.closeEditFact();
    editor.closeAddModal();
    // extraction 状态由 useFactsExtraction 的 [auPath] effect 自行管理
  }, [auPath]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 只应随 auPath / statusFilter 重拉（reloadFacts 稳定引用有意省略，边沿触发同 useAuSettingsData）
  useEffect(() => {
    void reloadFacts();
  }, [auPath, factsFilter.statusFilter]);

  const handleStatusChange = async (factId: string, nextStatus: string) => {
    if (!auPath) return;
    const requestAuPath = auPath;
    const targetFact = data.facts.find((fact) => fact.id === factId);
    const chapterNum = targetFact?.chapter || editor.editingFact?.chapter || 1;
    try {
      await updateFactStatus(requestAuPath, factId, nextStatus, chapterNum);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      await reloadFacts();
      if (editor.editingFact?.id === factId) {
        editor.patchEditingFact({ status: nextStatus as FactStatus });
      }
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t("error_messages.unknown"));
    }
  };

  // M10-B：取消归档（恢复冷存的笔记，重新纳入 AI 续写的事实表）。
  const handleUnarchive = async (factId: string) => {
    if (!auPath) return;
    const requestAuPath = auPath;
    try {
      await unarchiveFact(requestAuPath, factId);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      await reloadFacts();
      if (editor.editingFact?.id === factId) {
        editor.patchEditingFact({ archived: false });
      }
      showSuccess(t("facts.unarchiveSuccess"));
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t("error_messages.unknown"));
    }
  };

  const counts: FactsCounts = {
    total: data.allFactsCounts.total ?? data.facts.length,
    active: data.allFactsCounts.active ?? 0,
    unresolved: data.allFactsCounts.unresolved ?? 0,
    resolved: data.allFactsCounts.resolved ?? 0,
    deprecated: data.allFactsCounts.deprecated ?? 0,
  };
  const showEmptyNotes =
    !data.loading &&
    data.facts.length === 0 &&
    !factsFilter.filter &&
    !factsFilter.statusFilter &&
    factsFilter.chapterFilter === null &&
    !factsFilter.characterFilter;
  const showNoSearchResult = !data.loading && factsFilter.filteredFacts.length === 0 && !showEmptyNotes;

  // 过期 facts 提醒（current_chapter - fact.chapter > 30）
  const currentChapter = data.state?.current_chapter || 1;
  const staleCount = data.facts.filter(
    (f) => (f.status === "active" || f.status === "unresolved") && currentChapter - f.chapter > 30,
  ).length;

  // 知情名单联想（M3 批一）：本条涉及角色优先 + 全库出现过的角色名
  const knowledgeNameSuggestions = useMemo(() => {
    const own = editor.editingFact?.characters ?? [];
    return [...new Set([...own, ...factsFilter.uniqueCharacters])];
  }, [editor.editingFact, factsFilter.uniqueCharacters]);

  const modals = (
    <FactsModals
      isMobile={isMobile}
      editor={editor}
      extraction={extraction}
      batch={batch}
      auPath={auPath}
      knowledgeNameSuggestions={knowledgeNameSuggestions}
      onStatusChange={handleStatusChange}
      onUnarchive={handleUnarchive}
    />
  );

  if (isMobile) {
    return (
      <>
        <div className="min-h-full bg-background pb-28 md:hidden">
          <FactsFilterBar
            variant="mobile"
            factsFilter={factsFilter}
            extraction={extraction}
            editor={editor}
            counts={counts}
          />
          <FactsListControls
            variant="mobile"
            extraction={extraction}
            staleCount={staleCount}
            factsFilter={factsFilter}
            batch={batch}
          />
          <FactsList
            variant="mobile"
            loading={data.loading}
            showEmptyNotes={showEmptyNotes}
            showNoSearchResult={showNoSearchResult}
            factsFilter={factsFilter}
            batch={batch}
            editor={editor}
            extraction={extraction}
          />
        </div>
        {modals}
      </>
    );
  }

  return (
    <>
      <div className="w-[360px] md:w-[420px] shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-surface/50 h-full relative">
        <FactsFilterBar
          variant="desktop"
          factsFilter={factsFilter}
          extraction={extraction}
          editor={editor}
          counts={counts}
        />
        <FactsListControls
          variant="desktop"
          extraction={extraction}
          staleCount={staleCount}
          factsFilter={factsFilter}
          batch={batch}
        />
        <FactsList
          variant="desktop"
          loading={data.loading}
          showEmptyNotes={showEmptyNotes}
          showNoSearchResult={showNoSearchResult}
          factsFilter={factsFilter}
          batch={batch}
          editor={editor}
          extraction={extraction}
        />
      </div>

      <div className="flex-1 flex flex-col bg-background relative h-full min-w-0">
        <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
          {editor.editingFact ? (
            <>
              <span className="font-mono text-sm font-semibold opacity-70">
                {editor.editingFact.id.split("-")[0]}{" "}
                <span className="font-sans font-normal opacity-70 ml-2">{t("facts.editing")}</span>
              </span>
              <div className="flex gap-3 items-center">
                <Button tone="neutral" fill="plain" size="sm" className="h-8" onClick={() => editor.closeEditFact()}>
                  {t("facts.cancelSelection")}
                </Button>
                <Button
                  tone="accent"
                  fill="solid"
                  size="sm"
                  className="h-8 w-24"
                  onClick={editor.handleSaveFact}
                  disabled={editor.savingFact}
                >
                  {editor.savingFact ? (
                    <Spinner size="sm" />
                  ) : editor.saveSuccess ? (
                    <>
                      <Check size={14} /> {t("facts.saved")}
                    </>
                  ) : (
                    t("common.actions.save")
                  )}
                </Button>
              </div>
            </>
          ) : (
            <span className="font-mono text-sm font-semibold opacity-40">{t("facts.unselected")}</span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-8 lg:p-12 w-full max-w-3xl mx-auto space-y-8">
          <FactEditorForm
            editor={editor}
            auPath={auPath}
            knowledgeNameSuggestions={knowledgeNameSuggestions}
            showFooter={false}
            onStatusChange={handleStatusChange}
            onUnarchive={handleUnarchive}
          />
        </div>
      </div>

      {modals}
    </>
  );
};
