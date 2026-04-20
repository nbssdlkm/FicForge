// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useState, useEffect } from 'react';
import { Spinner } from "../shared/Spinner";
import { useActiveRequestGuard } from '../../hooks/useActiveRequestGuard';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Toggle } from '../shared/Toggle';
import { ModelSelector } from '../shared/ModelSelector';
import { Tag } from '../shared/Tag';
import { Modal } from '../shared/Modal';
import { Settings, Save, Trash2, Plus } from 'lucide-react';
import { getProjectForEditing, saveAuSettingsForEditing, saveProjectCastRegistryAndCoreIncludes, type ProjectInfo } from '../../api/engine-client';
import { getSettingsForEditing, type SettingsInfo } from '../../api/engine-client';
import { getState, recalcState, rebuildIndex } from '../../api/engine-client';
import { GlobalSettingsModal } from './GlobalSettingsModal';
import { LlmModeSelect } from './LlmModeSelect';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';
import { AuSettingsWritingSection } from './AuSettingsWritingSection';
import { AuSettingsPinnedSection } from './AuSettingsPinnedSection';
import { AuSettingsAdvancedSection } from './AuSettingsAdvancedSection';
import { SecretStorageNotice } from '../shared/SecretStorageNotice';
import {
  buildAuSettingsSaveInput,
  createDefaultAuSettingsFormState,
  hydrateAuSettingsForm,
} from './form-mappers';

export const AuSettingsLayout = ({ auPath }: { auPath: string }) => {
  const { t } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const loadGuard = useActiveRequestGuard(auPath);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [globalSettings, setGlobalSettings] = useState<SettingsInfo | null>(null);
  const [indexStatus, setIndexStatus] = useState('stale');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isGlobalSettingsOpen, setGlobalSettingsOpen] = useState(false);

  // Editable state (initialised from project)
  const [perspective, setPerspective] = useState('third_person');
  const [emotionStyle, setEmotionStyle] = useState('implicit');
  const [chapterLength, setChapterLength] = useState(2000);
  const [customInstructions, setCustomInstructions] = useState('');
  const [pinnedContext, setPinnedContext] = useState<string[]>([]);
  const [coreIncludes, setCoreIncludes] = useState<string[]>([]);
  
  // AU Override config states
  const [isLlmOverride, setIsLlmOverride] = useState(false);
  const [llmMode, setLlmMode] = useState('api');
  const [auModel, setAuModel] = useState('');
  const [auLocalModelPath, setAuLocalModelPath] = useState('');
  const [auOllamaModel, setAuOllamaModel] = useState('');
  const [auApiBase, setAuApiBase] = useState('');
  const [auApiKey, setAuApiKey] = useState('');
  const [contextWindow, setContextWindow] = useState(128000);
  const [coreIncludeModalOpen, setCoreIncludeModalOpen] = useState(false);
  const [recalcing, setRecalcing] = useState(false);

  // AU Embedding override
  const [isEmbeddingOverride, setIsEmbeddingOverride] = useState(false);
  const [embModel, setEmbModel] = useState('');
  const [embApiBase, setEmbApiBase] = useState('');
  const [embApiKey, setEmbApiKey] = useState('');

  const handleRecalc = async () => {
    const requestAuPath = auPath;
    setRecalcing(true);
    try {
      const result = await recalcState(auPath);
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showSuccess(t('advanced.recalcSuccess', { scanned: result.chapters_scanned, dirty: result.cleaned_dirty_count }));
    } catch (error) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(error, t('error_messages.unknown'));
    } finally {
      if (!loadGuard.isKeyStale(requestAuPath)) {
        setRecalcing(false);
      }
    }
  };

  useEffect(() => {
    if (!auPath) return;
    const defaults = createDefaultAuSettingsFormState();
    setLoading(true);
    setSaving(false);
    setRecalcing(false);
    setProject(null);
    setGlobalSettings(null);
    setIndexStatus('stale');
    setPerspective(defaults.perspective);
    setEmotionStyle(defaults.emotionStyle);
    setChapterLength(defaults.chapterLength);
    setCustomInstructions(defaults.customInstructions);
    setPinnedContext(defaults.pinnedContext);
    setCoreIncludes(defaults.coreIncludes);
    setIsLlmOverride(defaults.isLlmOverride);
    setLlmMode(defaults.llmMode);
    setAuModel(defaults.auModel);
    setAuLocalModelPath(defaults.auLocalModelPath);
    setAuOllamaModel(defaults.auOllamaModel);
    setAuApiBase(defaults.auApiBase);
    setAuApiKey(defaults.auApiKey);
    setContextWindow(defaults.contextWindow);
    setGlobalSettingsOpen(false);
    setCoreIncludeModalOpen(false);
    setIsEmbeddingOverride(defaults.isEmbeddingOverride);
    setEmbModel(defaults.embModel);
    setEmbApiBase(defaults.embApiBase);
    setEmbApiKey(defaults.embApiKey);

    const token = loadGuard.start();
    Promise.allSettled([
      getProjectForEditing(auPath),
      getSettingsForEditing(),
      getState(auPath),
    ]).then(([projResult, settingsResult, stateResult]) => {
      if (loadGuard.isStale(token)) return;
      let firstError: unknown = null;
      const proj = projResult.status === 'fulfilled' ? projResult.value : null;
      const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
      const state = stateResult.status === 'fulfilled' ? stateResult.value : null;

      if (projResult.status === 'rejected') firstError = firstError || projResult.reason;
      if (settingsResult.status === 'rejected') firstError = firstError || settingsResult.reason;
      if (stateResult.status === 'rejected') firstError = firstError || stateResult.reason;

      setProject(proj);
      setGlobalSettings(settings);
      setIndexStatus(state?.index_status || 'stale');
      if (proj) {
        const form = hydrateAuSettingsForm(proj);
        setPerspective(form.perspective);
        setEmotionStyle(form.emotionStyle);
        setChapterLength(form.chapterLength);
        setCustomInstructions(form.customInstructions);
        setPinnedContext(form.pinnedContext);
        setCoreIncludes(form.coreIncludes);
        setIsEmbeddingOverride(form.isEmbeddingOverride);
        setEmbModel(form.embModel);
        setEmbApiBase(form.embApiBase);
        setEmbApiKey(form.embApiKey);
        setIsLlmOverride(form.isLlmOverride);
        setLlmMode(form.llmMode);
        setAuModel(form.auModel);
        setAuLocalModelPath(form.auLocalModelPath);
        setAuOllamaModel(form.auOllamaModel);
        setAuApiBase(form.auApiBase);
        setAuApiKey(form.auApiKey);
        setContextWindow(form.contextWindow);
      }
      if (firstError) {
        showError(firstError, t('error_messages.unknown'));
      }
    }).finally(() => {
      if (!loadGuard.isStale(token)) {
        setLoading(false);
      }
    });
  }, [auPath]);

  const handleSave = async () => {
    const requestAuPath = auPath;
    setSaving(true);
    try {
      if (!project) {
        throw new Error(t("settingsMode.error.projectUnavailable"));
      }
      await saveAuSettingsForEditing(auPath, buildAuSettingsSaveInput({
        perspective,
        emotionStyle,
        chapterLength,
        customInstructions,
        pinnedContext,
        coreIncludes,
        isLlmOverride,
        llmMode,
        auModel,
        auLocalModelPath,
        auOllamaModel,
        auApiBase,
        auApiKey,
        contextWindow,
        isEmbeddingOverride,
        embModel,
        embApiBase,
        embApiKey,
      }));
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showSuccess(t("common.actions.save"));
    } catch (e: any) {
      if (loadGuard.isKeyStale(requestAuPath)) return;
      showError(e, t("error_messages.unknown"));
    } finally {
      if (!loadGuard.isKeyStale(requestAuPath)) {
        setSaving(false);
      }
    }
  };

  const addPinnedRule = () => setPinnedContext(prev => [...prev, '']);
  const removePinnedRule = (idx: number) => setPinnedContext(prev => prev.filter((_, i) => i !== idx));
  const updatePinnedRule = (idx: number, value: string) => setPinnedContext(prev => prev.map((v, i) => i === idx ? value : v));

  const removeCoreInclude = (idx: number) => setCoreIncludes(prev => prev.filter((_, i) => i !== idx));

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
            <Button tone="accent" fill="solid" className="w-full gap-2 shadow-md md:w-24" onClick={handleSave} disabled={saving}>
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
                   <Toggle checked={isLlmOverride} onChange={e => setIsLlmOverride(e.target.checked)} label={t("settings.story.overrideToggle")} />
                   <Button tone="neutral" fill="plain" size="sm" onClick={() => setGlobalSettingsOpen(true)}>{t("common.actions.viewGlobalSettings")}</Button>
                </div>
              </div>

              {isLlmOverride && (
                <div className="pt-4 border-t border-black/10 dark:border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-text/90">{t("common.labels.searchMode")}</label>
                    <LlmModeSelect value={llmMode} onChange={setLlmMode} />
                  </div>
                  {llmMode === 'api' && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-text/90">{t("settings.story.storyModel")}</label>
                        <ModelSelector value={auModel} onChange={setAuModel} onApiBaseAutoFill={setAuApiBase} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                         <label className="text-xs font-bold text-text/90">{t("common.labels.apiKey")}</label>
                         <Input type="password" value={auApiKey} onChange={e => setAuApiKey(e.target.value)} placeholder="sk-..." className="h-11 text-base md:h-9 md:text-sm" />
                         <p className="text-xs text-text/50">{t("common.help.apiKey")}</p>
                      </div>
                      <div className="flex flex-col gap-1.5 md:col-span-2">
                         <label className="text-xs font-bold text-text/90">{t("common.labels.apiBase")}</label>
                         <Input value={auApiBase} onChange={e => setAuApiBase(e.target.value)} placeholder="https://api.deepseek.com" className="h-11 text-base md:h-9 md:text-sm" />
                         <p className="text-xs text-text/50">{t("common.help.apiBase")}</p>
                      </div>
                    </>
                  )}
                  {llmMode === 'local' && (
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="text-xs font-bold text-text/90">{t("common.labels.localModelPath")}</label>
                      <Input value={auLocalModelPath} onChange={e => setAuLocalModelPath(e.target.value)} placeholder="/path/to/model" className="h-11 text-base md:h-9 md:text-sm" />
                      <p className="text-xs text-text/50">{t("common.help.localModelPath")}</p>
                    </div>
                  )}
                  {llmMode === 'ollama' && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-text/90">{t("common.labels.ollamaModel")}</label>
                        <Input value={auOllamaModel} onChange={e => setAuOllamaModel(e.target.value)} placeholder="llama3" className="h-11 text-base md:h-9 md:text-sm" />
                        <p className="text-xs text-text/50">{t("common.help.ollamaModel")}</p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                         <label className="text-xs font-bold text-text/90">{t("common.labels.apiBase")}</label>
                         <Input value={auApiBase} onChange={e => setAuApiBase(e.target.value)} placeholder="http://localhost:11434/v1" className="h-11 text-base md:h-9 md:text-sm" />
                         <p className="text-xs text-text/50">{t("common.help.apiBase")}</p>
                      </div>
                    </>
                  )}
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                     <label className="text-xs font-bold text-text/90">{t("common.labels.contextWindow")}</label>
                     <Input type="number" value={contextWindow} onChange={e => setContextWindow(parseInt(e.target.value, 10) || 0)} className="h-11 text-base md:h-9 md:text-sm" />
                     <p className="text-xs text-text/50">{t("common.help.contextWindow")}</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-sans font-bold text-info border-l-4 border-info pl-3">{t("settings.sections.searchEngine")}</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-text/90">{t("common.labels.searchEngineModel")}</label>
                {!isEmbeddingOverride && (
                  <Input value={globalSettings?.embedding?.model || t("settings.global.builtinEmbeddingLabel")} readOnly className="h-11 bg-background/70 font-mono text-base md:h-10 md:text-sm" />
                )}
                <label className="flex min-h-[44px] items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={isEmbeddingOverride} onChange={e => setIsEmbeddingOverride(e.target.checked)} disabled={saving} className="accent-accent" />
                  {t("settings.au.useCustomEmbedding")}
                </label>
                {isEmbeddingOverride && (
                  <div className="space-y-2 pl-6 border-l-2 border-info/30">
                    <Input value={embModel} onChange={e => setEmbModel(e.target.value)} placeholder={t("settings.global.embeddingModelPlaceholder")} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" />
                    <Input value={embApiBase} onChange={e => setEmbApiBase(e.target.value)} placeholder={t("settings.global.embeddingApiBasePlaceholder")} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" />
                    <Input value={embApiKey} onChange={e => setEmbApiKey(e.target.value)} placeholder={t("settings.global.embeddingApiKeyPlaceholder")} disabled={saving} className="h-11 text-base md:h-8 md:text-sm" type="password" />
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
            perspective={perspective}
            setPerspective={setPerspective}
            emotionStyle={emotionStyle}
            setEmotionStyle={setEmotionStyle}
            chapterLength={chapterLength}
            setChapterLength={setChapterLength}
            customInstructions={customInstructions}
            setCustomInstructions={setCustomInstructions}
          />

          {/* 3. 铁律 Pinned Context */}
          <AuSettingsPinnedSection
            pinnedContext={pinnedContext}
            addPinnedRule={addPinnedRule}
            removePinnedRule={removePinnedRule}
            updatePinnedRule={updatePinnedRule}
          />

          {/* 浮动保存按钮 — 编辑底线后方便保存 */}
          <div className="flex justify-end">
            <Button tone="accent" fill="solid" className="shadow-md gap-2" onClick={handleSave} disabled={saving}>
              <Save size={16}/> {saving ? t("common.status.saving") : t("common.actions.save")}
            </Button>
          </div>

          {/* 4. Core Includes */}
          <section className="space-y-6">
            <h2 className="text-lg font-sans font-bold text-success border-l-4 border-success pl-3">{t("settings.sections.coreIncludes")}</h2>
            <p className="text-sm text-text/70">{t("settings.story.coreIncludesDescription")}</p>
            
            <div className="flex gap-3 flex-wrap">
              {coreIncludes.length === 0 ? (
                <p className="text-sm text-text/50">{t("settings.emptyCoreIncludes")}</p>
              ) : (
                coreIncludes.map((file, idx) => (
                  <Tag key={idx} tone="success" className="px-3 py-1.5 text-sm gap-2">
                    <span>{file}</span>
                    <button className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:text-success/50 md:h-auto md:w-auto" onClick={() => removeCoreInclude(idx)}><Trash2 size={14}/></button>
                  </Tag>
                ))
              )}
              <Button tone="neutral" fill="plain" size="sm" className="h-11 border border-dashed border-success/30 text-sm text-success hover:bg-success/5 md:h-8 md:text-xs" onClick={() => setCoreIncludeModalOpen(true)}>
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
                          onClick={async () => {
                            const next = (project.cast_registry.characters || []).filter((n: string) => n !== c);
                            // 同时从必带角色中移除
                            const nextPins = coreIncludes.filter(n => n !== c);
                            try {
                              await saveProjectCastRegistryAndCoreIncludes(auPath, {
                                characters: next,
                                core_always_include: nextPins,
                              });
                              setProject(prev => prev ? { ...prev, cast_registry: { ...prev.cast_registry, characters: next }, core_always_include: nextPins } : prev);
                              setCoreIncludes(nextPins);
                            } catch (e) {
                              showError(e, t("settings.removeCastFail"));
                            }
                          }}
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
            recalcing={recalcing}
            handleRecalc={handleRecalc}
            handleRebuildIndex={async () => {
              try {
                await rebuildIndex(auPath);
                showSuccess(t('advanced.rebuildIndexSuccess'));
              } catch (e) {
                showError(e, t('advanced.rebuildIndexFail'));
              }
            }}
          />

          <div className="h-10 md:h-20"></div>
        </div>
      </main>
      <GlobalSettingsModal isOpen={isGlobalSettingsOpen} onClose={() => setGlobalSettingsOpen(false)} />
      <Modal isOpen={coreIncludeModalOpen} onClose={() => setCoreIncludeModalOpen(false)} title={t("settings.createCoreIncludeTitle")}>
        <div className="space-y-4">
          {(() => {
            const available = (project?.cast_registry?.characters || []).filter(c => !coreIncludes.includes(c));
            return available.length > 0 ? (
              <div className="space-y-2">
                {available.map(name => (
                  <button key={name} className="min-h-[44px] w-full rounded-lg border border-black/10 px-3 py-2 text-left text-sm transition-colors hover:border-accent/30 hover:bg-accent/10 dark:border-white/10" onClick={() => { setCoreIncludes(prev => [...prev, name]); setCoreIncludeModalOpen(false); }}>
                    {name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text/50">{t("settings.coreIncludeNoAvailable")}</p>
            );
          })()}
          <div className="flex justify-end">
            <Button tone="neutral" fill="plain" onClick={() => setCoreIncludeModalOpen(false)}>{t("common.actions.cancel")}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
