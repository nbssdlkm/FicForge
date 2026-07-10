// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useRef } from 'react';
import { addFact, editFact, type FactInfo } from '../../api/engine-client';
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { useTranslation } from '../../i18n/useAppTranslation';
import { useFeedback } from '../../hooks/useFeedback';

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

      await editFact(requestAuPath, editingFact.id, updatedFields);
      if (guard.isKeyStale(requestAuPath)) return;
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 2000);
      await onSaved();
      setEditingFact(prev => prev ? { ...prev, ...updatedFields } : null);
    } catch (error) {
      if (guard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!guard.isKeyStale(requestAuPath)) {
        setSavingFact(false);
      }
    }
  };

  /** 打开某条笔记的编辑视图。 */
  const startEditFact = (fact: FactInfo) => setEditingFact(fact);

  /** 关闭编辑视图（取消选择 / 关弹窗共用）。 */
  const closeEditFact = () => setEditingFact(null);

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
  };
}
