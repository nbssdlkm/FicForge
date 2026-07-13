// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Modal } from "../../shared/Modal";
import { Button } from "../../shared/Button";
import { Input } from "../../shared/Input";
import { Spinner } from "../../shared/Spinner";
import { ConfirmDialog } from "../../shared/ConfirmDialog";
import { SecretStorageNotice } from "../../shared/SecretStorageNotice";
import { useTranslation } from "../../../i18n/useAppTranslation";
import { useFeedback } from "../../../hooks/useFeedback";
import { deleteCustomProvider, saveCustomProvider, type CustomProviderInfo } from "../../../api/engine-client";

export interface CustomProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** null = 新建；非 null = 编辑（含删除入口）。 */
  provider: CustomProviderInfo | null;
  /** 当前配置槽位（api_base）正引用该供应商 —— 删除确认里加提示。 */
  deleteInUse?: boolean;
  onSaved: (saved: CustomProviderInfo, apiKeyEntered: string | undefined) => void;
  onDeleted: (providerId: string) => void;
}

/** 自定义供应商表单：名称 / BaseUrl / Key（高级折叠 chatPath）。全 OpenAI 兼容单协议（蓝图 §三.2）。 */
export function CustomProviderModal({
  isOpen,
  onClose,
  provider,
  deleteInUse,
  onSaved,
  onDeleted,
}: CustomProviderModalProps) {
  const { t } = useTranslation();
  const { showError } = useFeedback();
  const nameId = useId();
  const baseUrlId = useId();
  const apiKeyId = useId();
  const chatPathId = useId();

  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [chatPath, setChatPath] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const isEdit = provider !== null;

  useEffect(() => {
    if (!isOpen) return;
    setDisplayName(provider?.displayName ?? "");
    setBaseUrl(provider?.baseUrl ?? "");
    setApiKey(""); // 编辑时留空 = 保持已存密钥（不回显真实值）
    setChatPath(provider?.chatPath ?? "");
    setAdvancedOpen(Boolean(provider?.chatPath));
    setSaving(false);
    setDeleting(false);
    setDeleteConfirmOpen(false);
  }, [isOpen, provider]);

  const canSave = displayName.trim().length > 0 && baseUrl.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // 编辑时 key 留空 = undefined（保持不变）；新建时空 key 照存空串（无密钥）
      const apiKeyInput = isEdit && apiKey === "" ? undefined : apiKey;
      const saved = await saveCustomProvider({
        ...(provider ? { id: provider.id } : {}),
        displayName: displayName.trim(),
        baseUrl: baseUrl.trim(),
        ...(chatPath.trim() ? { chatPath: chatPath.trim() } : {}),
        ...(apiKeyInput !== undefined ? { api_key: apiKeyInput } : {}),
        models: provider?.models ?? [],
      });
      onSaved(saved, apiKeyInput);
      onClose();
    } catch (error) {
      showError(error, t("error_messages.unknown"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!provider) return;
    setDeleting(true);
    try {
      await deleteCustomProvider(provider.id);
      setDeleteConfirmOpen(false);
      onDeleted(provider.id);
      onClose();
    } catch (error) {
      showError(error, t("error_messages.unknown"));
    } finally {
      setDeleting(false);
    }
  };

  const busy = saving || deleting;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={busy ? () => {} : onClose}
        title={isEdit ? t("modelPicker.customProvider.editTitle") : t("modelPicker.customProvider.addTitle")}
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-bold text-text/90">
              {t("modelPicker.customProvider.name")}
            </label>
            <Input
              id={nameId}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("modelPicker.customProvider.namePlaceholder")}
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={baseUrlId} className="text-sm font-bold text-text/90">
              {t("common.labels.apiBase")}
            </label>
            <Input
              id={baseUrlId}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              disabled={busy}
            />
            <p className="text-xs text-text/50">{t("modelPicker.customProvider.baseUrlHint")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={apiKeyId} className="text-sm font-bold text-text/90">
              {t("common.labels.apiKey")}
            </label>
            <Input
              id={apiKeyId}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                isEdit && provider?.has_api_key ? t("modelPicker.customProvider.apiKeyKeepPlaceholder") : "sk-..."
              }
              disabled={busy}
            />
            {isEdit && provider?.has_api_key && (
              <p className="text-xs text-text/50">{t("modelPicker.customProvider.apiKeyKeepHint")}</p>
            )}
          </div>

          {/* 密钥输入面缺口补齐（E5 安全 L1）：本 modal 全屏覆盖父设置页，父页的
              SecretStorageNotice 被盖住 → 用户在此填 key 时看不到明文存储警示，此处补一条
              （加密环境显 info，不加密显 warning，文案与全局同一套 i18n 键）。 */}
          <SecretStorageNotice compact />

          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-bold text-text/60 hover:text-text/90"
            >
              {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {t("modelPicker.customProvider.advanced")}
            </button>
            {advancedOpen && (
              <div className="mt-2 flex flex-col gap-1.5 border-l-2 border-rule pl-3">
                <label htmlFor={chatPathId} className="text-xs font-bold text-text/90">
                  {t("modelPicker.customProvider.chatPath")}
                </label>
                <Input
                  id={chatPathId}
                  value={chatPath}
                  onChange={(e) => setChatPath(e.target.value)}
                  placeholder="/chat/completions"
                  disabled={busy}
                  className="h-9 text-sm"
                />
                <p className="text-xs text-text/50">{t("modelPicker.customProvider.chatPathHint")}</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-rule pt-4">
            {isEdit ? (
              <Button
                tone="destructive"
                fill="plain"
                size="sm"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={busy}
              >
                <Trash2 size={14} className="mr-1" /> {t("modelPicker.customProvider.delete")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button tone="neutral" fill="plain" onClick={onClose} disabled={busy}>
                {t("common.actions.cancel")}
              </Button>
              <Button tone="accent" fill="solid" onClick={() => void handleSave()} disabled={busy || !canSave}>
                {saving ? <Spinner size="sm" className="mr-1" /> : null}
                {t("common.actions.save")}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title={t("modelPicker.customProvider.deleteConfirmTitle")}
        message={
          <>
            <p>{t("modelPicker.customProvider.deleteConfirmMessage", { name: provider?.displayName ?? "" })}</p>
            {deleteInUse && (
              <p className="mt-2 font-bold text-warning">{t("modelPicker.customProvider.deleteInUseWarning")}</p>
            )}
          </>
        }
        destructive
        loading={deleting}
      />
    </>
  );
}
