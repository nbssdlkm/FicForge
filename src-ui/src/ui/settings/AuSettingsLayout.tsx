import { useState, useEffect } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { Tag } from '../shared/Tag';
import { Modal } from '../shared/Modal';
import { Settings, Save, Trash2, Plus, Loader2, AlertCircle } from 'lucide-react';
import { getProject, updateProject, type ProjectInfo } from '../../api/project';
import { getSettings, updateSettings } from '../../api/settings';
import { getState, recalcState } from '../../api/state';
import { GlobalSettingsModal } from './GlobalSettingsModal';
import { EmptyState } from '../shared/EmptyState';
import { useTranslation } from '../../i18n/useAppTranslation';
import { getEnumLabel } from '../../i18n/labels';
import { useFeedback } from '../../hooks/useFeedback';

export const AuSettingsLayout = ({ auPath }: { auPath: string }) => {
  const { t } = useTranslation();
  const { showError, showSuccess } = useFeedback();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
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
  const [isLlMOverride, setIsLlmOverride] = useState(false);
  const [llmMode, setLlmMode] = useState('api');
  const [auModel, setAuModel] = useState('');
  const [auApiBase, setAuApiBase] = useState('');
  const [auApiKey, setAuApiKey] = useState('');
  const [contextWindow, setContextWindow] = useState(128000);
  const [coreIncludeModalOpen, setCoreIncludeModalOpen] = useState(false);
  const [coreIncludeName, setCoreIncludeName] = useState('');
  const [recalcing, setRecalcing] = useState(false);

  const handleRecalc = async () => {
    setRecalcing(true);
    try {
      const result = await recalcState(auPath);
      showSuccess(t('advanced.recalcSuccess', { scanned: result.chapters_scanned, dirty: result.cleaned_dirty_count }));
    } catch (error) {
      showError(error, t('error_messages.unknown'));
    } finally {
      setRecalcing(false);
    }
  };

  useEffect(() => {
    if (!auPath) return;
    setLoading(true);
    Promise.all([
      getProject(auPath).catch(() => null),
      getSettings().catch(() => null),
      getState(auPath).catch(() => null),
    ]).then(([proj, settings, state]) => {
      setProject(proj);
      setGlobalSettings(settings);
      setIndexStatus((state as any)?.index_status || 'stale');
      if (proj) {
        setPerspective(proj.writing_style?.perspective || 'third_person');
        setEmotionStyle(proj.writing_style?.emotion_style || 'implicit');
        setChapterLength(proj.chapter_length || 2000);
        setCustomInstructions(proj.writing_style?.custom_instructions || '');
        setPinnedContext(proj.pinned_context || []);
        setCoreIncludes(proj.core_always_include || []);
        
        // Load AU LLM config if present
        if (proj.llm && proj.llm.model) {
          setIsLlmOverride(true);
          setLlmMode(proj.llm.mode || 'api');
          setAuModel(proj.llm.model);
          setAuApiBase(proj.llm.api_base || '');
          setAuApiKey(proj.llm.api_key || '');
          setContextWindow(proj.llm.context_window || 128000);
        }
      }
    }).finally(() => setLoading(false));
  }, [auPath]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (globalSettings) {
        await updateSettings('./fandoms', globalSettings);
      }
      if (project) {
        const payload: any = {
          chapter_length: chapterLength,
          writing_style: {
            ...project.writing_style,
            perspective,
            emotion_style: emotionStyle,
            custom_instructions: customInstructions,
          },
          pinned_context: pinnedContext,
          core_always_include: coreIncludes,
        };
        
        if (isLlMOverride) {
           payload.llm = {
             ...project.llm,
             mode: llmMode,
             model: auModel,
             api_base: auApiBase,
             api_key: auApiKey,
             context_window: contextWindow,
           };
        } else {
           // Clear it so it falls back to global
           payload.llm = { mode: 'api', model: '', api_base: '', api_key: '', context_window: 0 };
        }
        
        await updateProject(auPath, payload);
      }
      showSuccess(t("common.actions.save"));
    } catch (e: any) {
      showError(e, t("error_messages.unknown"));
    } finally {
      setSaving(false);
    }
  };

  const addPinnedRule = () => setPinnedContext(prev => [...prev, '']);
  const removePinnedRule = (idx: number) => setPinnedContext(prev => prev.filter((_, i) => i !== idx));
  const updatePinnedRule = (idx: number, value: string) => setPinnedContext(prev => prev.map((v, i) => i === idx ? value : v));

  const removeCoreInclude = (idx: number) => setCoreIncludes(prev => prev.filter((_, i) => i !== idx));
  const addCoreInclude = () => {
    const value = coreIncludeName.trim();
    if (!value) return;
    setCoreIncludes(prev => [...prev, value]);
    setCoreIncludeName('');
    setCoreIncludeModalOpen(false);
  };

  const auName = project?.name || auPath.split('/').pop() || t('common.unknownAu');

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-accent" size={32} />
      </main>
    );
  }

  return (
    <>
      <main className="flex-1 overflow-y-auto w-full">
        <div className="max-w-4xl mx-auto p-8 lg:p-12 space-y-12">
          
          <header className="flex justify-between items-center pb-6 border-b border-black/10 dark:border-white/10">
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-2xl font-bold flex items-center gap-2">
                <Settings className="text-accent" />
                {t("settings.headerTitle")} <span className="text-lg font-normal opacity-50 ml-2">{t("settings.story.scopeLabel", { name: auName })}</span>
              </h1>
            </div>
            <Button variant="primary" className="w-24 shadow-md gap-2" onClick={handleSave} disabled={saving}>
              <Save size={16}/> {saving ? t("common.status.saving") : t("common.actions.save")}
            </Button>
          </header>

          {/* 1. 模型与 API 配置 */}
          <section className="space-y-4">
            <h2 className="text-lg font-sans font-bold text-accent border-l-4 border-accent pl-3">{t("settings.sections.llm")}</h2>
            <div className="bg-surface/50 p-6 rounded-xl border border-black/5 dark:border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                   <h3 className="text-sm font-bold text-text/90 mb-1">{t("settings.story.overrideToggleLabel")}</h3>
                   <p className="text-xs text-text/50">{t("settings.story.inheritDescription")}</p>
                </div>
                <div className="flex items-center gap-3">
                   <Button variant="ghost" size="sm" onClick={() => setGlobalSettingsOpen(true)}>{t("common.actions.viewGlobalSettings")}</Button>
                   <label className="relative inline-flex items-center cursor-pointer">
                     <input type="checkbox" className="sr-only peer" checked={isLlMOverride} onChange={e => setIsLlmOverride(e.target.checked)} />
                     <div className="w-9 h-5 bg-black/20 dark:bg-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                   </label>
                </div>
              </div>

              {isLlMOverride && (
                <div className="pt-4 border-t border-black/10 dark:border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-text/80">{t("common.labels.searchMode")}</label>
                    <select value={llmMode} onChange={e => setLlmMode(e.target.value)} className="h-9 rounded-md border border-black/20 dark:border-white/20 bg-background px-3 text-sm focus:ring-2 focus:ring-accent outline-none">
                      <option value="api">{getEnumLabel("llm_mode", "api", "api")}</option>
                      <option value="local">{getEnumLabel("llm_mode", "local", "local")}</option>
                      <option value="ollama">{getEnumLabel("llm_mode", "ollama", "ollama")}</option>
                    </select>
                    <p className="text-xs text-text/50">{t(`common.help.llmMode.${llmMode}`)}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-text/80">{t("settings.story.storyModel")}</label>
                    <Input value={auModel} onChange={e => setAuModel(e.target.value)} placeholder="deepseek-chat" className="h-9 text-sm" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                     <label className="text-xs font-bold text-text/80">{t("common.labels.apiKey")}</label>
                     <Input type="password" value={auApiKey} onChange={e => setAuApiKey(e.target.value)} placeholder="sk-..." className="h-9 text-sm" />
                     <p className="text-xs text-text/50">{t("common.help.apiKey")}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                     <label className="text-xs font-bold text-text/80">{t("common.labels.apiBase")}</label>
                     <Input value={auApiBase} onChange={e => setAuApiBase(e.target.value)} placeholder="https://api.deepseek.com" className="h-9 text-sm" />
                     <p className="text-xs text-text/50">{t("common.help.apiBase")}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                     <label className="text-xs font-bold text-text/80">{t("common.labels.contextWindow")}</label>
                     <Input type="number" value={contextWindow} onChange={e => setContextWindow(parseInt(e.target.value, 10) || 0)} className="h-9 text-sm" />
                     <p className="text-xs text-text/50">{t("common.help.contextWindow")}</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-sans font-bold text-info border-l-4 border-info pl-3">{t("settings.sections.searchEngine")}</h2>
            <div className="bg-surface/50 p-6 rounded-xl border border-black/5 dark:border-white/5 space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-text/90">{t("common.labels.searchEngineModel")}</label>
                <Input value={globalSettings?.embedding?.model || ''} readOnly className="h-10 font-mono bg-background/70" />
                <p className="text-xs text-text/50">{t("common.help.searchEngineModel")}</p>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-black/10 dark:border-white/10 bg-background/60 px-4 py-3">
                <span className="text-sm text-text/80">{t("settings.global.searchEngineDescription")}</span>
                <Tag variant="info" className="text-xs">{getEnumLabel("index_status", indexStatus, indexStatus)}</Tag>
              </div>
            </div>
          </section>

          {/* 2. 文风与结构控制 */}
          <section className="space-y-6">
            <h2 className="text-lg font-sans font-bold text-accent border-l-4 border-accent pl-3">{t("settings.sections.writingStyle")}</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-surface/50 p-6 rounded-xl border border-black/5 dark:border-white/5">
              <div className="flex flex-col gap-4">
                 <div className="flex flex-col gap-2">
                   <label className="text-sm font-bold text-text/90">{t("common.labels.perspective")}</label>
                   <select value={perspective} onChange={e => setPerspective(e.target.value)} className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-background px-3 text-sm focus:ring-2 focus:ring-accent outline-none">
                     <option value="third_person">{getEnumLabel("perspective", "third_person", "third_person")}</option>
                     <option value="first_person">{getEnumLabel("perspective", "first_person", "first_person")}</option>
                   </select>
                 </div>
                 <div className="flex flex-col gap-2">
                   <label className="text-sm font-bold text-text/90">{t("common.labels.emotionStyle")}</label>
                   <select value={emotionStyle} onChange={e => setEmotionStyle(e.target.value)} className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-background px-3 text-sm focus:ring-2 focus:ring-accent outline-none">
                     <option value="implicit">{getEnumLabel("emotion_style", "implicit", "implicit")}</option>
                     <option value="explicit">{getEnumLabel("emotion_style", "explicit", "explicit")}</option>
                   </select>
                 </div>
                 <div className="flex flex-col gap-2">
                   <label className="text-sm font-bold text-text/90">{t("common.labels.chapterLength")}</label>
                   <Input type="number" value={chapterLength} onChange={e => setChapterLength(parseInt(e.target.value) || 2000)} className="h-10 font-mono" />
                   <p className="text-xs text-text/50">{t("settings.story.chapterLengthDescription")}</p>
                 </div>
              </div>

              <div className="flex flex-col gap-2 flex-1">
                 <label className="text-sm font-bold text-text/90">{t("common.labels.customInstructions")}</label>
                 <Textarea 
                   value={customInstructions}
                   onChange={e => setCustomInstructions(e.target.value)}
                   placeholder={t("settings.story.customInstructionsPlaceholder")}
                   className="font-serif min-h-[200px] text-sm leading-relaxed bg-background p-4 resize-y" 
                 />
              </div>
            </div>
          </section>

          {/* 3. 铁律 Pinned Context */}
          <section className="space-y-6">
            <h2 className="text-lg font-sans font-bold text-error border-l-4 border-error pl-3 flex justify-between items-center">
               <span>{t("settings.sections.pinnedContext")}</span>
               <Button variant="secondary" size="sm" className="h-8 text-xs font-normal border-error/30 text-error hover:bg-error/10" onClick={addPinnedRule}>
                 <Plus size={14} className="mr-1"/> {t("common.actions.addPinnedRule")}
               </Button>
            </h2>
            <p className="text-sm text-text/60">{t("settings.story.pinnedDescription")}</p>
            
            <div className="space-y-3">
               {pinnedContext.length === 0 ? (
                 <EmptyState
                   compact
                   icon={<AlertCircle size={28} />}
                   title={t("settings.emptyPinned.title")}
                   description={t("settings.emptyPinned.description")}
                   actions={[
                     {
                       key: "add-pinned",
                       element: (
                         <Button variant="primary" onClick={addPinnedRule}>
                           {t("common.actions.addPinnedRule")}
                         </Button>
                       ),
                     },
                   ]}
                 />
               ) : (
                 pinnedContext.map((pc, idx) => (
                   <div key={idx} className="flex gap-3 items-start bg-error/5 p-4 rounded-lg border border-error/20">
                     <span className="font-mono text-error/50 font-bold mt-1 text-sm">{idx+1}.</span>
                     <Textarea className="min-h-[60px] flex-1 bg-background text-sm font-serif" value={pc} onChange={e => updatePinnedRule(idx, e.target.value)} />
                     <Button variant="ghost" size="sm" className="text-error/60 hover:text-error hover:bg-error/10 p-2 h-auto" onClick={() => removePinnedRule(idx)}>
                       <Trash2 size={16}/>
                     </Button>
                   </div>
                 ))
               )}
            </div>
          </section>

          {/* 4. Core Includes */}
          <section className="space-y-6">
            <h2 className="text-lg font-sans font-bold text-success border-l-4 border-success pl-3">{t("settings.sections.coreIncludes")}</h2>
            <p className="text-sm text-text/60">{t("settings.story.coreIncludesDescription")}</p>
            
            <div className="flex gap-3 flex-wrap">
              {coreIncludes.length === 0 ? (
                <p className="text-sm text-text/40">{t("settings.emptyCoreIncludes")}</p>
              ) : (
                coreIncludes.map((file, idx) => (
                  <Tag key={idx} variant="success" className="px-3 py-1.5 text-sm gap-2">
                    <span>{file}</span>
                    <button className="hover:text-success/50" onClick={() => removeCoreInclude(idx)}><Trash2 size={14}/></button>
                  </Tag>
                ))
              )}
              <Button variant="ghost" size="sm" className="h-8 border border-dashed border-success/30 text-success hover:bg-success/5" onClick={() => setCoreIncludeModalOpen(true)}>
                <Plus size={14} className="mr-1"/> {t("common.actions.addFile")}
              </Button>
            </div>
          </section>

          {/* 5. Cast Registry (D-0022: unified characters list) */}
          {project?.cast_registry && (
            <section className="space-y-6">
              <h2 className="text-lg font-sans font-bold text-info border-l-4 border-info pl-3">{t("settings.sections.castRegistry")}</h2>
              <div className="bg-surface/50 p-4 rounded-xl border border-black/5 dark:border-white/5">
                <h3 className="text-xs font-bold text-text/60 uppercase mb-2">{t("common.labels.characters")}</h3>
                {(project.cast_registry.characters || []).length === 0 ? (
                  <p className="text-xs text-text/40">{t("settings.emptyCastRegistry")}</p>
                ) : (
                  <div className="flex flex-wrap gap-1">{project.cast_registry.characters.map(c => <Tag key={c} variant="default" className="text-xs">{c}</Tag>)}</div>
                )}
              </div>
            </section>
          )}

          {/* 高级操作 (sub-task 4) */}
          <section className="space-y-4 pt-6 border-t border-black/10 dark:border-white/10">
            <h2 className="text-lg font-sans font-bold text-text/50 border-l-4 border-text/20 pl-3">{t('advanced.title')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-surface/50 p-4 rounded-xl border border-black/5 dark:border-white/5">
                <Button variant="secondary" size="sm" className="w-full mb-2" onClick={handleRecalc} disabled={recalcing}>
                  {recalcing ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                  {t('advanced.recalc')}
                </Button>
                <p className="text-xs text-text/40">{t('advanced.recalcDesc')}</p>
              </div>
              <div className="bg-surface/50 p-4 rounded-xl border border-black/5 dark:border-white/5">
                <Button variant="secondary" size="sm" className="w-full mb-2 opacity-50 cursor-not-allowed" disabled title={t('advanced.rebuildIndexDesc')}>
                  {t('advanced.rebuildIndex')}
                </Button>
                <p className="text-xs text-text/40">{t('advanced.rebuildIndexDesc')}</p>
              </div>
            </div>
            <p className="text-xs text-text/30">{t('advanced.advancedHint')}</p>
          </section>

          <div className="h-20"></div>
        </div>
      </main>
      <GlobalSettingsModal isOpen={isGlobalSettingsOpen} onClose={() => setGlobalSettingsOpen(false)} />
      <Modal isOpen={coreIncludeModalOpen} onClose={() => setCoreIncludeModalOpen(false)} title={t("settings.createCoreIncludeTitle")}>
        <div className="space-y-4">
          <Input
            value={coreIncludeName}
            onChange={e => setCoreIncludeName(e.target.value)}
            placeholder={t("settings.createCoreIncludePlaceholder")}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCoreIncludeModalOpen(false)}>{t("common.actions.cancel")}</Button>
            <Button variant="primary" onClick={addCoreInclude} disabled={!coreIncludeName.trim()}>{t("common.actions.confirm")}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
