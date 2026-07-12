// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef } from 'react';
import { addFact, editFact, type FactInfo } from '../../api/engine-client';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';

/** 知情范围（known_to）编辑的四态。some = 指定名单。 */
export type KnownToMode = 'unset' | 'all' | 'reader_only' | 'some';

/** fact.known_to → 编辑四态 + 初始名单（裸字符串为历史脏数据，按单人名单进 some 态；
 *  类型上并入 string 以覆盖引擎消毒上线前的存量磁盘形态）。 */
function deriveKnownToState(knownTo: FactInfo['known_to'] | string): { mode: KnownToMode; names: string[] } {
  if (knownTo === 'all') return { mode: 'all', names: [] };
  if (knownTo === 'reader_only') return { mode: 'reader_only', names: [] };
  if (Array.isArray(knownTo) && knownTo.length > 0) return { mode: 'some', names: knownTo };
  if (typeof knownTo === 'string' && knownTo.trim() !== '') return { mode: 'some', names: [knownTo.trim()] };
  return { mode: 'unset', names: [] };
}

/** 名单提交公共判据：trim + 去空 + 去重。 */
function commitName(list: string[], draft: string): string[] {
  const name = draft.trim();
  if (!name || list.includes(name)) return list;
  return [...list, name];
}

export function useFactEditor(auPath: string, currentChapter: number, onSaved: () => void) {
  const { t } = useTranslation();
  const { showError } = useFeedback();

  const guard = useActiveRequestGuard(auPath);

  const [editingFact, setEditingFact] = useState<FactInfo | null>(null);
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [newContentRaw, setNewContentRaw] = useState('');
  const [newContentClean, setNewContentClean] = useState('');
  const [newType, setNewType] = useState('plot_event');
  const [newWeight, setNewWeight] = useState('medium');
  const [newStatus, setNewStatus] = useState('active');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savingFact, setSavingFact] = useState(false);
  const [adding, setAdding] = useState(false);

  const editContentCleanRef = useRef<HTMLTextAreaElement>(null);
  const editContentRawRef = useRef<HTMLTextAreaElement>(null);
  const editCharactersRef = useRef<HTMLInputElement>(null);
  const editWeightRef = useRef<HTMLSelectElement>(null);

  // ---- 知情范围（M3 批一）----
  // 名单没法走非受控 ref（chips 是 state），必须住在本 hook；编辑器切换 fact 靠外层 key remount
  // 只重置 DOM 非受控输入、不重置 hook state —— 所以 startEditFact 必须按新 fact 重新初始化
  // （否则上一条的名单会串进下一条，实施前调查明示的头号坑）。
  const [knownToMode, setKnownToMode] = useState<KnownToMode>('unset');
  const [knownToNames, setKnownToNames] = useState<string[]>([]);
  const [knownToDraft, setKnownToDraft] = useState('');
  const [hiddenFromNames, setHiddenFromNames] = useState<string[]>([]);
  const [hiddenFromDraft, setHiddenFromDraft] = useState('');
  // 竞态门（对抗审 MED-4）：保存请求在飞时用户切到另一条笔记，迟到的回写不得污染新笔记。
  // auPath 级的 guard 挡不住同 AU 内换条目，须按 fact id 再加一道。
  const editingFactIdRef = useRef<string | null>(null);

  const resetAddModal = () => {
    setNewContentRaw('');
    setNewContentClean('');
    setNewType('plot_event');
    setNewWeight('medium');
    setNewStatus('active');
  };

  const handleAddFact = async () => {
    if (!newContentClean.trim() || !auPath || adding) return;
    const requestAuPath = auPath;
    const chapterNum = Math.max(1, (currentChapter || 1) - 1 || 1);
    setAdding(true);
    try {
      await addFact(requestAuPath, chapterNum, {
        content_raw: newContentRaw || newContentClean,
        content_clean: newContentClean,
        type: newType,
        narrative_weight: newWeight,
        status: newStatus,
        characters: [],
      });
      if (guard.isKeyStale(requestAuPath)) return;
      setAddModalOpen(false);
      resetAddModal();
      await onSaved();
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setAdding(false);
      }
    }
  };

  const handleSaveFact = async () => {
    if (!editingFact || !auPath) return;
    const requestAuPath = auPath;
    const requestFactId = editingFact.id;
    setSavingFact(true);
    setSaveSuccess(false);
    try {
      const updatedFields: Record<string, any> = {};
      if (editContentCleanRef.current) updatedFields.content_clean = editContentCleanRef.current.value;
      if (editContentRawRef.current) updatedFields.content_raw = editContentRawRef.current.value;
      if (editCharactersRef.current) {
        updatedFields.characters = editCharactersRef.current.value
          .split(',')
          .map((item: string) => item.trim())
          .filter(Boolean);
      }
      if (editWeightRef.current) updatedFields.narrative_weight = editWeightRef.current.value;

      // 知情范围（M3 批一）：未按回车的草稿视同已提交（防手滑丢名字）；some 空名单折叠 null
      // （与引擎消毒口径一致）。只发生变化的字段才进 payload —— 引擎空编辑早退 + 这里的
      // 脏检查双保险，杜绝 revision 空转。
      const finalKnownToNames = commitName(knownToNames, knownToDraft);
      const finalHiddenFrom = commitName(hiddenFromNames, hiddenFromDraft);
      const assembledKnownTo: FactInfo['known_to'] =
        knownToMode === 'unset' ? null
        : knownToMode === 'all' ? 'all'
        : knownToMode === 'reader_only' ? 'reader_only'
        : finalKnownToNames.length > 0 ? finalKnownToNames : null;
      const origKnownTo = editingFact.known_to ?? null;
      const origHiddenFrom = editingFact.hidden_from ?? [];
      if (JSON.stringify(assembledKnownTo) !== JSON.stringify(origKnownTo)) {
        updatedFields.known_to = assembledKnownTo;
      }
      if (JSON.stringify(finalHiddenFrom) !== JSON.stringify(origHiddenFrom)) {
        updatedFields.hidden_from = finalHiddenFrom;
      }

      const saved = await editFact(requestAuPath, editingFact.id, updatedFields) as FactInfo | undefined;
      if (guard.isKeyStale(requestAuPath)) return;
      // 竞态门（对抗审 MED-4）：请求在飞期间用户已切到别的笔记 → 丢弃回写，不污染新笔记
      if (editingFactIdRef.current !== requestFactId) return;
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 2000);
      await onSaved();
      if (editingFactIdRef.current !== requestFactId) return;   // onSaved 期间也可能切走
      // 知情字段以引擎回传为准（引擎可能做了跨字段矛盾化解，如「同名同现两名单 → 瞒着方胜」）；
      // 引擎不回传时（测试 mock / 旧接口）退回本地组装值。
      const nextKnownTo = saved
        ? (saved.known_to ?? null)
        : ('known_to' in updatedFields ? assembledKnownTo : origKnownTo);
      const nextHiddenFrom = saved
        ? (Array.isArray(saved.hidden_from) ? saved.hidden_from : [])
        : ('hidden_from' in updatedFields ? finalHiddenFrom : (origHiddenFrom as string[]));
      setEditingFact(prev =>
        prev && prev.id === requestFactId
          ? { ...prev, ...updatedFields, known_to: nextKnownTo, hidden_from: nextHiddenFrom }
          : prev,
      );
      // 从最终落库值重建编辑 state（顺带解决对抗审 LOW-1：some 空名单保存为 null 后模式回落 unset）
      const kt = deriveKnownToState(nextKnownTo);
      setKnownToMode(kt.mode);
      setKnownToNames(kt.names);
      setKnownToDraft('');
      setHiddenFromNames(nextHiddenFrom);
      setHiddenFromDraft('');
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setSavingFact(false);
      }
    }
  };

  /** 打开某条笔记的编辑视图（知情范围 state 按该 fact 重新初始化 —— 语义化注入，防串条）。 */
  const startEditFact = (fact: FactInfo) => {
    editingFactIdRef.current = fact.id;
    setEditingFact(fact);
    const kt = deriveKnownToState(fact.known_to ?? null);
    setKnownToMode(kt.mode);
    setKnownToNames(kt.names);
    setKnownToDraft('');
    setHiddenFromNames(Array.isArray(fact.hidden_from) ? fact.hidden_from : []);
    setHiddenFromDraft('');
  };

  /** 关闭编辑视图（取消选择 / 关弹窗共用）。 */
  const closeEditFact = () => {
    editingFactIdRef.current = null;
    setEditingFact(null);
    setKnownToMode('unset');
    setKnownToNames([]);
    setKnownToDraft('');
    setHiddenFromNames([]);
    setHiddenFromDraft('');
  };

  // ---- 知情范围的语义化操作（动词命名；不对外暴露名单的裸 setter）----
  const selectKnownToMode = (mode: KnownToMode) => setKnownToMode(mode);
  const commitKnownToName = () => {
    setKnownToNames(prev => commitName(prev, knownToDraft));
    setKnownToDraft('');
  };
  const removeKnownToNameAt = (index: number) =>
    setKnownToNames(prev => prev.filter((_, i) => i !== index));
  const popLastKnownToName = () => setKnownToNames(prev => prev.slice(0, -1));
  const commitHiddenFromName = () => {
    setHiddenFromNames(prev => commitName(prev, hiddenFromDraft));
    setHiddenFromDraft('');
  };
  const removeHiddenFromNameAt = (index: number) =>
    setHiddenFromNames(prev => prev.filter((_, i) => i !== index));
  const popLastHiddenFromName = () => setHiddenFromNames(prev => prev.slice(0, -1));

  /**
   * 生命周期操作（弃用/取消归档等）成功后，把编辑视图里的这条同步为最新字段 ——
   * 语义化注入方法（用引擎结果同步），不是裸 setState。
   */
  const patchEditingFact = (patch: Partial<FactInfo>) =>
    setEditingFact((prev) => (prev ? { ...prev, ...patch } : null));

  const openAddModal = () => setAddModalOpen(true);
  const closeAddModal = () => setAddModalOpen(false);

  return {
    editingFact,
    startEditFact,
    closeEditFact,
    patchEditingFact,
    isAddModalOpen,
    openAddModal,
    closeAddModal,
    // 以下 setNew*：新建/编辑表单字段的受控绑定（textarea/select 双向绑定，铁律允许的例外）
    newContentRaw,
    setNewContentRaw,
    newContentClean,
    setNewContentClean,
    newType,
    setNewType,
    newWeight,
    setNewWeight,
    newStatus,
    setNewStatus,
    saveSuccess,
    savingFact,
    adding,
    editContentCleanRef,
    editContentRawRef,
    editCharactersRef,
    editWeightRef,
    resetAddModal,
    handleAddFact,
    handleSaveFact,
    // ---- 知情范围（M3 批一）----
    knownToMode,
    knownToNames,
    hiddenFromNames,
    selectKnownToMode,
    commitKnownToName,
    removeKnownToNameAt,
    popLastKnownToName,
    commitHiddenFromName,
    removeHiddenFromNameAt,
    popLastHiddenFromName,
    // 两个名单草稿的受控绑定（input 双向绑定，铁律允许的例外）
    knownToDraft,
    setKnownToDraft,
    hiddenFromDraft,
    setHiddenFromDraft,
  };
}
