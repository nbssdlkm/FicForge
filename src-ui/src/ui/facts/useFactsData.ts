// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useState } from "react";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import { getState, listFacts, type FactInfo, type StateInfo } from "../../api/engine-client";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import { swallowToNull } from "../../utils/ui-logger";

/**
 * useFactsData — 事实笔记页的只读数据拉取（server 侧按状态筛选的显示集 / 全量计数 / index 状态）。
 *
 * 拆自 FactsLayout god 组件（长期债②）。自持 facts / state / loading / allFactsCounts，
 * auPath 切换在本 hook 内 reset（铁律 2：state 与 reset 同文件）；对外只暴露 value 与
 * 动词方法 loadFacts，不外泄 raw setter（铁律 5）。
 *
 * loadFacts(statusFilter?)：一次拉三份 —— server 按 statusFilter 拉显示集、无筛选拉全量算
 * tab 计数、getState 拿 index/current_chapter。"stale" 是 useFactsFilter 的客户端伪筛选，
 * 这里当 undefined 全量拉，由 filter hook 客户端过滤。
 *
 * statusFilter 的所有权：它属 useFactsFilter 的状态，而 useFactsFilter 又依赖本 hook 的
 * facts（构成环）—— 故本 hook 不持有 statusFilter，由调用点（FactsLayout）显式传入；
 * mutation 后重拉用 ref 绑定「当前 statusFilter」（见 FactsLayout 的 reloadFacts）。
 */
export function useFactsData(auPath: string) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const loadGuard = useActiveRequestGuard(auPath);

  const [facts, setFacts] = useState<FactInfo[]>([]);
  const [state, setState] = useState<StateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [allFactsCounts, setAllFactsCounts] = useState<Record<string, number>>({});

  const loadFacts = useCallback(
    async (statusFilter?: string) => {
      if (!auPath) return;
      const token = loadGuard.start();
      setLoading(true);
      try {
        const [factsData, allFactsData, stateData] = await Promise.all([
          listFacts(auPath, statusFilter && statusFilter !== "stale" ? statusFilter : undefined),
          listFacts(auPath),
          getState(auPath).catch(swallowToNull("useFactsData", "load state failed")),
        ]);
        if (loadGuard.isStale(token)) return;
        setFacts(factsData);
        setState(stateData);
        const counts: Record<string, number> = { total: allFactsData.length };
        for (const f of allFactsData) {
          counts[f.status] = (counts[f.status] || 0) + 1;
        }
        setAllFactsCounts(counts);
      } catch (error) {
        if (loadGuard.isStale(token)) return;
        showError(error, t("error_messages.unknown"));
      } finally {
        if (!loadGuard.isStale(token)) {
          setLoading(false);
        }
      }
    },
    [auPath, loadGuard, showError, t],
  );

  // 铁律 2：state 与 reset 同文件 —— AU 切换清空本 hook 自持的显示数据。
  // 与旧 FactsLayout 一致：**不清 allFactsCounts**（下次 loadFacts 覆盖），避免切换瞬间 tab 计数闪 0。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内全是 setter（非依赖），仅应随 auPath 变化重置显示数据；biome 判 auPath 多余，删掉会导致切 AU 不再复位（残留上一篇 facts/state）
  useEffect(() => {
    setLoading(true);
    setFacts([]);
    setState(null);
  }, [auPath]);

  return { facts, state, loading, allFactsCounts, loadFacts };
}
