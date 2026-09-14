// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * 剧情线详情屏（M8-B UI + REQ-140 编排板）。
 *
 * 把 Fact 挂到这条线上当「节点」（成员关系真相源 = fact.thread_ids），REQ-140 起节点顺序
 * 由用户编排（fact.thread_order 显式序号，无序号按章号+时间派生兜底）：缝隙「+」可在任意
 * 位置插入、上移/下移换位、摘除按钮常显、「编辑笔记」跳剧情笔记页改 fact 本体。
 */

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { Button } from "../shared/Button";
import { Input } from "../shared/Input";
import { Modal } from "../shared/Modal";
import { EmptyState } from "../shared/EmptyState";
import { Tag } from "../shared/Tag";
import { goldLine } from "../shared/tokens";
import { ArrowLeft, Plus, Pencil, X, Search, RefreshCw, ArrowUp, ArrowDown, BookOpen } from "lucide-react";
import { useFeedback } from "../../hooks/useFeedback";
import { useTranslation } from "../../i18n/useAppTranslation";
import { getEnumLabel } from "../../i18n/labels";
import {
  addFactToThread,
  removeFactFromThread,
  moveFactInThread,
  setFactThreadRole,
  getStaleThreads,
  regenerateThreadState,
  type FactInfo,
} from "../../api/engine-client";
import { ThreadStatus, sortThreadFacts } from "@ficforge/engine";
import type { Thread } from "@ficforge/engine";

const headerGoldLines = {
  boxShadow: `inset 0 ${goldLine.topThick} 0 var(--color-gold-bright), inset 0 ${goldLine.bottomThick} 0 var(--color-gold-bright)`,
};

const STATUS_TONE: Record<string, "unresolved" | "active" | "resolved"> = {
  [ThreadStatus.ACTIVE]: "active",
  [ThreadStatus.RESOLVED]: "resolved",
  [ThreadStatus.DORMANT]: "unresolved",
};

interface ThreadDetailProps {
  auPath: string;
  thread: Thread;
  facts: FactInfo[];
  onBack: () => void;
  onEdit: (thread: Thread) => void;
  onChanged: () => void | Promise<void>;
  /** REQ-140：「编辑笔记」跳转（跳到剧情笔记页开该 fact 编辑态）。宿主不提供时按钮不渲染。 */
  onEditFact?: (factId: string) => void;
}

/** 缝隙插入的位置上下文：挂在 beforeFactId/afterFactId 两邻居之间；均空 = 尾部追加。 */
interface InsertAt {
  beforeFactId?: string;
  afterFactId?: string;
}

export const ThreadDetail = ({ auPath, thread, facts, onBack, onEdit, onChanged, onEditFact }: ThreadDetailProps) => {
  const { t } = useTranslation();
  const { showError } = useFeedback();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const [pickerAt, setPickerAt] = useState<InsertAt | undefined>(undefined); // 本次 picker 的落位（REQ-140）
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef<Set<string>>(new Set()); // 同步 in-flight 哨兵（state 是异步、防不住快速双触发）
  const pendingEscapeRef = useRef(false); // Escape 丢弃意图：拦下随后被动 blur 的误存

  // REQ-140：节点按「用户编排序」（显式 thread_order 优先，无章序者按章号+时间派生兜底）
  const nodes = useMemo(() => sortThreadFacts(facts, thread.id), [facts, thread.id]);

  const available = useMemo(() => {
    const q = pickerFilter.trim().toLowerCase();
    return facts
      .filter((f) => !(f.thread_ids ?? []).includes(thread.id))
      .filter(
        (f) =>
          !q ||
          (f.content_clean ?? "").toLowerCase().includes(q) ||
          (f.characters ?? []).some((c) => c.toLowerCase().includes(q)),
      )
      .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
  }, [facts, thread.id, pickerFilter]);

  const guard = async (id: string, fn: () => Promise<void>) => {
    if (busyRef.current.has(id)) return; // 同步去重：同一 fact 在飞的操作不重入
    busyRef.current.add(id);
    setBusyId(id);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      showError(err, t("error_messages.unknown"));
    } finally {
      busyRef.current.delete(id);
      setBusyId(null);
    }
  };

  // B2 最后一公里：进展陈旧检测（零 LLM，engine 侧算）+ 按需刷新（点击才烧 token）。
  const [staleCount, setStaleCount] = useState(0);
  const [refreshingState, setRefreshingState] = useState(false);

  // 陈旧数随 thread.id / updated_at 变化重算（刷新成功后 onChanged 会带来新 updated_at → 自动清零）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: thread.updated_at 是有意的重算触发键——刷新后 onChanged 抬升 updated_at → effect 重跑 → 陈旧数自动清零；体内不直接读它；biome 判其多余，删掉会破坏刷新后重算
  useEffect(() => {
    let alive = true;
    getStaleThreads(auPath)
      .then((stale) => {
        if (alive) setStaleCount(stale.find((s) => s.thread_id === thread.id)?.new_fact_count ?? 0);
      })
      .catch(() => {
        if (alive) setStaleCount(0);
      });
    return () => {
      alive = false;
    };
  }, [auPath, thread.id, thread.updated_at]);

  const handleRefreshState = async () => {
    if (refreshingState) return;
    setRefreshingState(true);
    try {
      const next = await regenerateThreadState(auPath, thread.id);
      if (next == null) {
        showError(new Error("empty"), t("error_messages.unknown"));
        return;
      }
      await onChanged(); // 重载 → 拿到新 state + 新 updated_at → useEffect 重算陈旧清零
    } catch (err) {
      showError(err, t("error_messages.unknown"));
    } finally {
      setRefreshingState(false);
    }
  };

  // 助手已改为内部读 fresh fact，这里不再传 UI 旧值（防 lost-update）。
  // REQ-140：pickerAt 携带缝隙落位；undefined（头部/空态入口）= 尾部追加。
  const addNode = (f: FactInfo) =>
    guard(f.id, async () => {
      await addFactToThread(auPath, f.id, thread.id, pickerAt);
      setPickerOpen(false); // 挂成功即关 picker（审 MINOR：原先不关、列表已变但弹窗滞留）
    });
  const removeNode = (f: FactInfo) => guard(f.id, () => removeFactFromThread(auPath, f.id, thread.id));
  // REQ-140：换位 = 与邻居交换后全线归一化持久化（见 engine-threads.moveFactInThread）
  const moveNode = (f: FactInfo, direction: "up" | "down") =>
    guard(f.id, () => moveFactInThread(auPath, thread.id, f.id, direction));
  const openPicker = (at: InsertAt = {}) => {
    setPickerFilter("");
    setPickerAt(at);
    setPickerOpen(true);
  };
  const saveRole = (f: FactInfo) =>
    guard(f.id, async () => {
      await setFactThreadRole(auPath, f.id, thread.id, roleDraft);
      setEditingRoleId(null);
    });

  // REQ-140：缝隙插入入口——「想在哪里挂就在哪里挂」。常显低噪（卡拉 2026-09-10 拍板：
  // hover 隐藏=发现性死亡的教训，见摘除按钮同款修复），hover/focus 才提亮。
  const GapInsert = ({ beforeFactId, afterFactId }: InsertAt) => (
    <button
      type="button"
      onClick={() => openPicker({ beforeFactId, afterFactId })}
      aria-label={t("threads.detail.insertHere")}
      className="flex h-4 w-full items-center justify-center rounded-sm text-ink-faint/50 transition-colors hover:bg-gold/10 hover:text-gold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gold-bright"
    >
      <Plus size={12} />
    </button>
  );

  // M8-A 叙事标签（flashback / reader-only / suspense）— UPPERCASE mono，同原型
  const nodeTags = (f: FactInfo): string[] => {
    const tags: string[] = [];
    if (f.time_kind && f.time_kind !== "normal") tags.push(getEnumLabel("time_kind", f.time_kind, f.time_kind));
    // M3 批一：文案收敛到 enums.known_to 单一真相源（原页面私有 key threads.detail.tag.readerOnly 已删）
    if (f.known_to === "reader_only") tags.push(getEnumLabel("known_to", "reader_only", "reader-only"));
    if (f.suspense_type) tags.push(getEnumLabel("suspense_type", f.suspense_type, f.suspense_type));
    return tags;
  };

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* 头：返回 + 标题 + 状态 + 编辑 */}
      <header className="flex shrink-0 items-center gap-3 border-b border-rule bg-surface px-4 py-3.5 md:px-6">
        <button
          type="button"
          onClick={onBack}
          aria-label={`${t("threads.detail.back")}: ${thread.title}`}
          className="flex items-center gap-1 font-sans text-[11px] font-medium tracking-[0.04em] text-accent hover:underline"
        >
          <ArrowLeft size={14} /> {t("threads.detail.back")}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-xl font-semibold text-text">{thread.title}</h1>
            <Tag tone={STATUS_TONE[thread.status] ?? "unresolved"}>{t(`threads.status.${thread.status}`)}</Tag>
          </div>
        </div>
        <Button tone="neutral" fill="outline" size="sm" className="shrink-0 gap-1" onClick={() => onEdit(thread)}>
          <Pencil size={14} /> {t("threads.detail.editThread")}
        </Button>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* 左：元数据 + 当前进展 banner（olive border-left） */}
        <aside className="shrink-0 space-y-4 border-b border-rule bg-surface/40 px-5 py-5 md:w-72 md:overflow-y-auto md:border-b-0 md:border-r">
          {thread.description ? (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-faint">
                {t("threads.field.description")}
              </div>
              <p className="font-serif text-[13px] leading-relaxed text-ink-muted">{thread.description}</p>
            </div>
          ) : null}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-faint">
                {t("threads.field.state")}
              </span>
              {nodes.length > 0 ? (
                <button
                  type="button"
                  onClick={handleRefreshState}
                  disabled={refreshingState}
                  className="flex items-center gap-1 font-sans text-[10px] font-medium text-accent hover:underline disabled:opacity-50"
                >
                  <RefreshCw size={11} className={refreshingState ? "animate-spin" : ""} />
                  {refreshingState ? t("threads.detail.refreshing") : t("threads.detail.refreshState")}
                </button>
              ) : null}
            </div>
            {thread.state ? (
              <p className="border-l-[3px] border-accent bg-accent/8 px-3 py-2 font-serif text-[13px] leading-relaxed text-text/90">
                {thread.state}
              </p>
            ) : (
              <p className="font-sans text-xs italic text-ink-faint">{t("threads.noState")}</p>
            )}
            {staleCount > 0 ? (
              <p className="mt-1.5 font-sans text-[10px] leading-snug text-gold">
                {t("threads.detail.stateStale", { count: staleCount })}
              </p>
            ) : null}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
            {t("threads.nodeCount", { count: nodes.length })}
          </div>
        </aside>

        {/* 右：节点列表 */}
        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            <div
              className="flex items-center justify-between gap-3 rounded-sm bg-drawer px-4 py-2.5 text-inv-text"
              style={headerGoldLines}
            >
              <span className="font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-gold-bright">
                {t("threads.detail.nodesTitle")}
              </span>
              <Button
                tone="neutral"
                fill="plain"
                size="sm"
                className="h-7 gap-1 text-inv-text/85 hover:bg-gold-bright/10 hover:text-inv-text"
                onClick={() => openPicker()}
              >
                <Plus size={14} /> {t("threads.detail.addNode")}
              </Button>
            </div>

            {nodes.length === 0 ? (
              <EmptyState
                compact
                icon={<Plus size={26} />}
                title={t("threads.detail.emptyNodesTitle")}
                description={t("threads.detail.emptyNodesDesc")}
                actions={[
                  {
                    key: "add",
                    element: (
                      <Button tone="accent" fill="solid" size="sm" onClick={() => openPicker()}>
                        {t("threads.detail.addNode")}
                      </Button>
                    ),
                  },
                ]}
              />
            ) : (
              <>
                {nodes.map((f, idx) => {
                  const role = f.thread_roles?.[thread.id] ?? "";
                  const tags = nodeTags(f);
                  return (
                    <Fragment key={f.id}>
                      {/* REQ-140：每个节点前的缝隙插入口（含首节点之前） */}
                      <GapInsert beforeFactId={f.id} afterFactId={nodes[idx - 1]?.id} />
                      <div className="group relative rounded-sm border border-rule bg-surface py-3 pl-5 pr-3">
                        <span
                          aria-hidden
                          className="pointer-events-none absolute left-0 top-3 bottom-3 w-[2px] rounded-r bg-gold opacity-65"
                        />
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 font-mono text-[10px] text-text/45">
                            {/* № = 本线内节点序，ch.X = 章号（审 NIT：两处别都显示章号） */}
                            <span className="text-gold">№ {String(idx + 1).padStart(2, "0")}</span>
                            <span>ch.{f.chapter ?? 0}</span>
                          </div>
                          {/* REQ-140：操作簇常显（上移/下移/编辑笔记/摘除）——hover 才显示曾让卡拉找不着摘除 */}
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => moveNode(f, "up")}
                              disabled={busyId === f.id || idx === 0}
                              aria-label={t("threads.detail.moveUp")}
                              className="rounded p-0.5 text-text/35 transition-colors hover:bg-rule-soft hover:text-text/70 disabled:opacity-30"
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveNode(f, "down")}
                              disabled={busyId === f.id || idx === nodes.length - 1}
                              aria-label={t("threads.detail.moveDown")}
                              className="rounded p-0.5 text-text/35 transition-colors hover:bg-rule-soft hover:text-text/70 disabled:opacity-30"
                            >
                              <ArrowDown size={13} />
                            </button>
                            {onEditFact ? (
                              <button
                                type="button"
                                onClick={() => onEditFact(f.id)}
                                aria-label={t("threads.detail.editFactNote")}
                                className="rounded p-0.5 text-text/35 transition-colors hover:bg-accent/10 hover:text-accent"
                              >
                                <BookOpen size={13} />
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => removeNode(f)}
                              disabled={busyId === f.id}
                              aria-label={t("threads.detail.removeNode")}
                              className="shrink-0 rounded p-0.5 text-text/35 transition-colors hover:bg-error/10 hover:text-error"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                        <p className="mt-1 font-serif text-[13px] leading-snug text-text/90">{f.content_clean}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {/* REQ-140：人物 + 故事时间元数据徽章（中性色调，区别于金色叙事标签） */}
                          {(f.characters ?? []).map((c) => (
                            <span
                              key={`char-${c}`}
                              className="rounded-[1px] border border-rule bg-rule-soft px-[5px] py-[2px] font-sans text-[9px] text-ink-muted"
                            >
                              {c}
                            </span>
                          ))}
                          {f.story_time_tag ? (
                            <span className="rounded-[1px] border border-rule bg-rule-soft px-[5px] py-[2px] font-mono text-[9px] text-ink-muted">
                              {f.story_time_tag}
                            </span>
                          ) : null}
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-[1px] border border-gold/30 bg-gold/15 px-[5px] py-[2px] font-mono text-[8px] font-medium uppercase tracking-[0.14em] text-gold"
                            >
                              {tag}
                            </span>
                          ))}
                          {/* thread_role — 「role」 显示，点击改 */}
                          {editingRoleId === f.id ? (
                            <Input
                              autoFocus
                              aria-label={t("threads.detail.roleLabel")}
                              value={roleDraft}
                              onChange={(e) => setRoleDraft(e.target.value)}
                              onBlur={() => {
                                if (pendingEscapeRef.current) {
                                  pendingEscapeRef.current = false;
                                  return;
                                }
                                saveRole(f);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  saveRole(f);
                                } else if (e.key === "Escape") {
                                  pendingEscapeRef.current = true;
                                  setEditingRoleId(null);
                                }
                              }}
                              placeholder={t("threads.detail.rolePlaceholder")}
                              className="h-7 w-40 text-xs"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRoleId(f.id);
                                setRoleDraft(role);
                              }}
                              className="font-display text-[13px] italic text-accent hover:underline"
                            >
                              {role ? `「${role}」` : `+ ${t("threads.detail.setRole")}`}
                            </button>
                          )}
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
                {/* 尾部缝隙 = 追加到最后 */}
                <GapInsert afterFactId={nodes[nodes.length - 1]?.id} />
              </>
            )}
          </div>
        </main>
      </div>

      {/* 挂节点：从未挂本线的 Fact 里选 */}
      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title={t("threads.detail.pickerTitle")}>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 text-text/40" size={15} />
            <Input
              autoFocus
              aria-label={t("threads.detail.pickerSearch")}
              value={pickerFilter}
              onChange={(e) => setPickerFilter(e.target.value)}
              placeholder={t("threads.detail.pickerSearch")}
              className="pl-9"
            />
          </div>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {available.length === 0 ? (
              <p className="py-6 text-center text-sm text-text/50">{t("threads.detail.pickerEmpty")}</p>
            ) : (
              available.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={busyId === f.id}
                  onClick={() => addNode(f)}
                  className="flex w-full items-start gap-2 rounded-sm border border-rule bg-surface/60 px-3 py-2 text-left transition-colors hover:border-gold/50 disabled:opacity-50"
                >
                  <span className="shrink-0 font-mono text-[10px] text-gold">ch.{f.chapter ?? 0}</span>
                  <span className="font-serif text-[13px] leading-snug text-text/90">{f.content_clean}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};
