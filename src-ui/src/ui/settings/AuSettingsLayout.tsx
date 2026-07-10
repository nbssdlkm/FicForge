// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { Spinner } from "../shared/Spinner";
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Toggle } from '../shared/Toggle';
import { ProviderModelPicker } from './model-picker/ProviderModelPicker';
import { Tag } from '../shared/Tag';
import { Modal } from '../shared/Modal';
import { Settings, Save, Trash2, Plus } from 'lucide-react';
import { saveProjectCastRegistryAndCoreIncludes } from '../../api/engine-client';
import { GlobalSettingsModal } from './GlobalSettingsModal';
import { LlmModeSelect } from './LlmModeSelect';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';
import { AuSettingsWritingSection } from './AuSettingsWritingSection';
import { AuSettingsPinnedSection } from './AuSettingsPinnedSection';
import { AuSettingsAdvancedSection } from './AuSettingsAdvancedSection';
import { BackfillMemoryModal } from './BackfillMemoryModal';
import { ArchiveCandidatesModal } from './ArchiveCandidatesModal';
import { SecretStorageNotice } from '../shared/SecretStorageNotice';
import { shouldWarnEmptyAuApiKey } from './form-mappers';
import { useAuSettingsData } from './useAuSettingsData';
import { useAuSettingsForm } from './useAuSettingsForm';
import { useAuSettingsModals } from './useAuSettingsModals';
import { useAuSettingsAdvancedOps } from './useAuSettingsAdvancedOps';

export const AuSettingsLayout = ({ auPath }: { auPath: string }) => {
  const { t } = useTranslation();
  const { showError } = useFeedback();

  const { project, globalSettings, indexStatus, loading, loadKey, syncCastRegistry } = useAuSettingsData(auPath);
  const {
    form, saving, save,
    setPerspective, setEmotionStyle, setChapterLength, setCustomInstructions,
    setIsLlmOverride, setLlmMode, setAuModel, setAuLocalModelPath, setAuOllamaModel,
    setAuApiBase, setAuApiKey, setContextWindow, setChatPath,
    setIsEmbeddingOverride, setEmbModel, setEmbApiBase, setEmbApiKey,
    addPinnedRule, removePinnedRule, updatePinnedRule,
    addCoreInclude, removeCoreInclude, replaceCoreIncludes,
  } = useAuSettingsForm(auPath, project, loadKey);

  const modals = useAuSettingsModals(auPath);
  const advanced = useAuSettingsAdvancedOps(auPath, modals.isArchiveOpen);

  const handleRemoveCastCharacter = async (name: string) => {
    if (!project) return;
    const nextCharacters = (project.cast_registry.characters || []).filter((n: string) => n !== name);
    // 同时从必带角色中移除
    const nextPins = form.coreIncludes.filter(n => n !== name);
    try {
      await saveProjectCastRegistryAndCoreIncludes(auPath, {
        characters: nextCharacters,
        core_always_include: nextPins,
      });
      syncCastRegistry(nextCharacters, nextPins);
      replaceCoreIncludes(nextPins);
    } catch (e) {
      showError(e, t("settings.removeCastFail"));
    }
  };

  const auName = project?.name || auPath.split('/').pop() || t('common.unknownAu');

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <Spinner size="lg" className="text-accent" />
      </main>
    );
  }

  return (
    <>
      <main className="flex-1 overflow-y-auto w-full">
        <div className="mx-auto max-w-4xl space-y-10 px-4 py-4 md:p-8 lg:p-12">

          <header className="flex flex-col gap-4 border-b border-black/10 pb-6 dark:border-white/10 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <h1 className="flex flex-wrap items-center gap-2 font-serif text-xl font-bold md:text-2xl">
                <Settings className="text-accent" />
                {t("settings.headerTitle")} <span className="text-lg font-normal opacity-50 ml-2">{t("settings.story.scopeLabel", { name: auName })}</span>
              </h1>
            </div>
            <Button tone="accent" fill="solid" className="w-full gap-2 shadow-md md:w-24" onClick={save} disabled={saving}>
              <Save size={16}/> {saving ? t("common.status.saving") : t("common.actions.save")}
            </Button>
          </header>

          <SecretStorageNotice auPath={auPath} />

          {/* 1. 模型与 API 配置 */}
          <section className="space-y-4">
            <h2 className="text-lg font-sans font-bold text-accent border-l-4 border-accent pl-3">{t("settings.sections.llm")}</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                   <h3 className="text-sm font-bold text-text/90 mb-1">{t("settings.story.overrideToggleLabel")}</h3>
                   <p className="text-xs text-text/50">{t("settings.story.inheritDescription")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                   <Toggle checked={form.isLlmOverride} onChange={e => setIsLlmOverride(e.target.checked)} label={t("settings.story.overrideToggle")} />
                   <Button tone="neutral" fill="plain" size="sm" onClick={modals.openGlobalSettings}>{t("common.actions.viewGlobalSettings")}</Button>
                </div>
              </div>

              {form.isLlmOverride && (
                <div className="pt-4 border-t border-black/10 dark:border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-text/90">{t("common.labels.searchMode")}</label>
                    <LlmModeSelect value={form.llmMode} onChange={setLlmMode} />
                  </div>
                  {form.llmMode === 'api' && (
                    <>
                      {/* 供应商主导选择器（与全局设置同一组件）：含 ctx 三态行 */}
                      <div className="md:col-span-2">
                        <ProviderModelPicker
                          kind="chat"
                          model={form.auModel}
                          onModelChange={setAuModel}
                          apiBase={form.auApiBase}
                          onApiBaseAutoFill={setAuApiBase}
                          onChatPathAutoFill={setChatPath}
                          apiKey={form.auApiKey}
                          onApiKeyAutoFill={setAuApiKey}
                          contextWindow={form.contextWindow}
                          onContextWindowChange={setContextWindow}
                          disabled={saving}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                         <label className="text-xs font-bold text-text/90">{t("common.labels.apiKey")}</label>
                         <Input type="password" value={form.auApiKey} onChange={e => setAuApiKey(e.target.value)} placeholder="sk-..." className="h-11 text-base md:h-9 md:text-sm" />
                         {shouldWarnEmptyAuApiKey(form.isLlmOverride, form.llmMode, form.auApiKey)
                           ? <p className="text-xs text-amber-600 dark:text-amber-500">{t("settings.story.apiKeyEmptyHint")}</p>
                           : <p className="text-xs text-text/50">{t("common.help.apiKey")}</p>}
                      </div>
                      <div className="flex flex-col gap-1.5">
                         <label className="text-xs font-bold text-text/90">{t("common.labels.apiBase")}</label>
                         <Input value={form.auApiBase} onChange={e => setAuApiBase(e.target.value)} placeholder="https://api.deepseek.com" className="h-11 text-base md:h-9 md:text-sm" />
                         <p className="text-xs text-text/50">{t("common.help.apiBase")}</p>
                      </div>
                    </>
                  )}
                  {form.llmMode === 'local' && (
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="text-xs font-bold text-text/90">{t("common.labels.localModelPath")}</label>
                      <Input value={form.auLocalModelPath} onChange={e => setAuLocalModelPath(e.target.value)} placeholder="/path/to/model" className="h-11 text-base md:h-9 md:text-sm" />
                      <p className="text-xs text-text/50">{t("common.help.localModelPath")}</p>
                    </div>
                  )}
                  {form.llmMode === 'ollama' && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-text/90">{t("common.labels.ollamaModel")}</label>
                        <Input value={form.auOllamaModel} onChange={e => setAuOllamaModel(e.target.value)} placeholder="llama3" className="h-11 text-base md:h-9 md:text-sm" />
                        <p className="text-xs text-text/50">{t("common.help.ollamaModel")}</p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                         <label className="text-xs font-bold text-text/90">{t("common.labels.apiBase")}</label>
                         <Input value={form.auApiBase} onChange={e => setAuApiBase(e.target.value)} placeholder="http://localhost:11434/v1" className="h-11 text-base md:h-9 md:text-sm" />
                         <p className="text-xs text-text/50">{t("common.help.apiBase")}</p>
                      </div>
                    </>
                  )}
                  {/* api 模式的 ctx 由 ProviderModelPicker 内联管理；其余模式保留手填 */}
                  {form.llmMode !== 'api' && (
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                       <label className="text-xs font-bold text-text/90">{t("common.labels.contextWindow")}</label>
                       <Input type="number" value={form.contextWindow} onChange={e => setContextWindow(e.target.value)} className="h-11 text-base md:h-9 md:text-sm" />
                       {/* "" = 窗口未知（R2-3）：显式警示，不静默按默认处理 */}
                       {form.contextWindow.trim() === ''
                         ? <p className="text-xs text-warning">{t("modelPicker.ctxUnknown")}</p>
                         : <p className="text-xs text-text/50">{t("common.help.contextWindow")}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-sans font-bold text-info border-l-4 border-info pl-3">{t("settings.sections.searchEngine")}</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-text/90">{t("common.labels.searchEngineModel")}</label>
                {!form.isEmbeddingOverride && (
                  <Input value={globalSettings?.embedding?.model || t("settings.global.noEmbeddingModel")} readOnly className="h-11 bg-background/70 font-mono text-base md:h-10 md:text-sm" />
                )}
                <label className="flex min-h-[44px] items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.isEmbeddingOverride} onChange={e => setIsEmbeddingOverride(e.target.checked)} disabled={saving} className="accent-accent" />
                  {t("settings.au.useCustomEmbedding")}
                </label>
                {form.isEmbeddingOverride && (
                  <div className="space-y-2 pl-6 border-l-2 border-info/30">
                    {/* embedding 槽位复用同一选择器（只显示 embedding 类型模型 + 手填） */}
                    <ProviderModelPicker
                      kind="embedding"
                      model={form.embModel}
                      onModelChange={setEmbModel}
                      apiBase={form.embApiBase}
                      onApiBaseAutoFill={setEmbApiBase}
                      apiKey={form.embApiKey}
                      onApiKeyAutoFill={setEmbApiKey}
                      disabled={saving}
                    />
                    <Input value={form.embApiBase} onChange={e => setEmbApiBase(e.target.value)} placeholder={t("settings.global.embeddingApiBasePlaceholder")} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" />
                    <Input value={form.embApiKey} onChange={e => setEmbApiKey(e.target.value)} placeholder={t("settings.global.embeddingApiKeyPlaceholder")} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" type="password" />
                  </div>
                )}
              </div>
              <div className="flex flex-col items-start gap-2 rounded-lg border border-black/10 dark:border-white/10 bg-background/60 px-4 py-3">
                <span className="text-sm text-text/90">{t("settings.global.searchEngineDescription")}</span>
                <Tag tone="info" className="text-xs">{getEnumLabel("index_status", indexStatus, indexStatus)}</Tag>
              </div>
            </div>
          </section>

          {/* 2. 文风与结构控制 */}
          <AuSettingsWritingSection
            perspective={form.perspective}
            setPerspective={setPerspective}
            emotionStyle={form.emotionStyle}
            setEmotionStyle={setEmotionStyle}
            chapterLength={form.chapterLength}
            setChapterLength={setChapterLength}
            customInstructions={form.customInstructions}
            setCustomInstructions={setCustomInstructions}
          />

          {/* 3. 铁律 Pinned Context */}
          <AuSettingsPinnedSection
            pinnedContext={form.pinnedContext}
            addPinnedRule={addPinnedRule}
            removePinnedRule={removePinnedRule}
            updatePinnedRule={updatePinnedRule}
          />

          {/* 浮动保存按钮 — 编辑底线后方便保存 */}
          <div className="flex justify-end">
            <Button tone="accent" fill="solid" className="shadow-md gap-2" onClick={save} disabled={saving}>
              <Save size={16}/> {saving ? t("common.status.saving") : t("common.actions.save")}
            </Button>
          </div>

          {/* 4. Core Includes */}
          <section className="space-y-6">
            <h2 className="text-lg font-sans font-bold text-success border-l-4 border-success pl-3">{t("settings.sections.coreIncludes")}</h2>
            <p className="text-sm text-text/70">{t("settings.story.coreIncludesDescription")}</p>

            <div className="flex gap-3 flex-wrap">
              {form.coreIncludes.length === 0 ? (
                <p className="text-sm text-text/50">{t("settings.emptyCoreIncludes")}</p>
              ) : (
                form.coreIncludes.map((file, idx) => (
                  <Tag key={idx} tone="success" className="px-3 py-1.5 text-sm gap-2">
                    <span>{file}</span>
                    <button className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:text-success/50 md:h-auto md:w-auto" onClick={() => removeCoreInclude(idx)}><Trash2 size={14}/></button>
                  </Tag>
                ))
              )}
              <Button tone="neutral" fill="plain" size="sm" className="h-11 border border-dashed border-success/30 text-sm text-success hover:bg-success/5 md:h-8 md:text-xs" onClick={modals.openCoreInclude}>
                <Plus size={14} className="mr-1"/> {t("common.actions.addFile")}
              </Button>
            </div>
          </section>

          {/* 5. Cast Registry (D-0022: unified characters list) */}
          {project?.cast_registry && (
            <section className="space-y-6">
              <h2 className="text-lg font-sans font-bold text-info border-l-4 border-info pl-3">{t("settings.sections.castRegistry")}</h2>
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-text/70 uppercase">{t("common.labels.characters")}</h3>
                {(project.cast_registry.characters || []).length === 0 ? (
                  <p className="text-xs text-text/50">{t("settings.emptyCastRegistry")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {project.cast_registry.characters.map(c => (
                      <span key={c} className="inline-flex items-center gap-1 rounded-md bg-black/5 dark:bg-white/5 px-2 py-1 text-xs">
                        {c}
                        <button
                          className="text-text/30 hover:text-error transition-colors"
                          title={t("settings.removeCastCharacter")}
                          onClick={() => handleRemoveCastCharacter(c)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 高级操作 (sub-task 4) */}
          <AuSettingsAdvancedSection
            recalcing={advanced.recalcing}
            handleRecalc={advanced.recalc}
            handleRebuildIndex={advanced.rebuildIndex}
            handleBackfillMemory={modals.openBackfill}
            handleArchiveFacts={modals.openArchive}
            archiveCandidateCount={advanced.archiveCandidateCount}
          />

          <div className="h-10 md:h-20"></div>
        </div>
      </main>
      <GlobalSettingsModal isOpen={modals.isGlobalSettingsOpen} onClose={modals.closeGlobalSettings} />
      <BackfillMemoryModal auPath={auPath} isOpen={modals.isBackfillOpen} onClose={modals.closeBackfill} />
      <ArchiveCandidatesModal auPath={auPath} isOpen={modals.isArchiveOpen} onClose={modals.closeArchive} />
      <Modal isOpen={modals.isCoreIncludeOpen} onClose={modals.closeCoreInclude} title={t("settings.createCoreIncludeTitle")}>
        <div className="space-y-4">
          {(() => {
            const available = (project?.cast_registry?.characters || []).filter(c => !form.coreIncludes.includes(c));
            return available.length > 0 ? (
              <div className="space-y-2">
                {available.map(name => (
                  <button key={name} className="min-h-[44px] w-full rounded-lg border border-black/10 px-3 py-2 text-left text-sm transition-colors hover:border-accent/30 hover:bg-accent/10 dark:border-white/10" onClick={() => { addCoreInclude(name); modals.closeCoreInclude(); }}>
                    {name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text/50">{t("settings.coreIncludeNoAvailable")}</p>
            );
          })()}
          <div className="flex justify-end">
            <Button tone="neutral" fill="plain" onClick={modals.closeCoreInclude}>{t("common.actions.cancel")}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
