// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Fact 反向视图（M8-B UI，「Appears in」）。
 *
 * 在剧情笔记编辑面板里展示：这条笔记归入了哪些剧情线、在每条线里担什么角色。
 * 与 ThreadDetail 互为正反——挂线/标角色在 ThreadDetail 做，这里只读展示（成员关系
 * 真相源 = fact.thread_ids，角色 = fact.thread_roles[threadId]）。设计取自原型 Fact 反向视图。
 */

import { useEffect, useMemo, useState } from "react";
import { Spline } from "lucide-react";
import { goldLine } from "../shared/tokens";
import { Tag } from "../shared/Tag";
import { useTranslation } from "../../i18n/useAppTranslation";
import { listThreads, logCatch } from "../../api/engine-client";
import { ThreadStatus } from "@ficforge/engine";
import type { Thread } from "@ficforge/engine";

const headerGoldLines = {
  boxShadow: `inset 0 ${goldLine.topThick} 0 var(--color-gold-bright), inset 0 ${goldLine.bottomThick} 0 var(--color-gold-bright)`,
};

const STATUS_TONE: Record<string, "unresolved" | "active" | "resolved"> = {
  [ThreadStatus.ACTIVE]: "active",
  [ThreadStatus.RESOLVED]: "resolved",
  [ThreadStatus.DORMANT]: "unresolved",
};

interface FactThreadsSectionProps {
  auPath: string;
  threadIds?: string[];
  threadRoles?: Record<string, string>;
}

export const FactThreadsSection = ({ auPath, threadIds, threadRoles }: FactThreadsSectionProps) => {
  const { t } = useTranslation();
  const [threads, setThreads] = useState<Thread[]>([]);

  useEffect(() => {
    let alive = true;
    // best-effort：剧情线读失败不阻断笔记编辑，但记日志（非静默吞错）。
    listThreads(auPath)
      .then((ts) => {
        if (alive) setThreads(ts);
      })
      .catch((err) => logCatch("facts", "listThreads for FactThreadsSection failed", err));
    return () => {
      alive = false;
    };
  }, [auPath]);

  const ids = threadIds ?? [];
  const byId = useMemo(() => new Map(threads.map((th) => [th.id, th])), [threads]);

  // 只展示能解析到的线（被删的线 id 残留则跳过，不渲染孤儿）。
  const memberships = useMemo(
    () =>
      ids
        .map((id) => ({ id, thread: byId.get(id), role: threadRoles?.[id] ?? "" }))
        .filter((m): m is { id: string; thread: Thread; role: string } => !!m.thread),
    [ids, byId, threadRoles],
  );

  return (
    <div className="flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/10">
      <div
        className="flex items-center justify-between gap-2 rounded-sm bg-drawer px-3 py-2 text-inv-text"
        style={headerGoldLines}
      >
        <span className="flex items-center gap-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-gold-bright">
          <Spline size={12} /> {t("threads.appearsIn.title")}
        </span>
      </div>

      {memberships.length === 0 ? (
        <p className="px-1 py-1 font-sans text-xs italic text-ink-faint">{t("threads.appearsIn.empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {memberships.map(({ id, thread, role }) => (
            <div key={id} className="group relative rounded-sm border border-rule bg-surface/60 py-2.5 pl-4 pr-3">
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-r bg-gold opacity-65"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-display text-sm font-medium text-text">{thread.title}</span>
                <Tag tone={STATUS_TONE[thread.status] ?? "unresolved"}>{t(`threads.status.${thread.status}`)}</Tag>
              </div>
              {role ? (
                <p className="mt-0.5 font-display text-[13px] italic text-accent">「{role}」</p>
              ) : (
                <p className="mt-0.5 font-sans text-[11px] italic text-ink-faint">{t("threads.appearsIn.noRole")}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
