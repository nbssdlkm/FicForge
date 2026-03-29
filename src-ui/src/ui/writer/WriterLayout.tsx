import { useState, useEffect, useCallback } from 'react';
import { ThemeToggle } from '../shared/ThemeToggle';
import { Button } from '../shared/Button';
import { Tag } from '../shared/Tag';
import { SettingsPanel } from '../settings/SettingsPanel';
import { Undo2, Check, FileUp, AlertCircle, Loader2, BookOpen } from 'lucide-react';
import { ExportModal } from './ExportModal';
import { DirtyModal } from './DirtyModal';
import { Sidebar } from '../shared/Sidebar';

import { getChapterContent, confirmChapter, undoChapter } from '../../api/chapters';
import { getState, setChapterFocus, type StateInfo } from '../../api/state';
import { listFacts, type FactInfo } from '../../api/facts';
import { generateChapter } from '../../api/generate';
import { getSettings, updateSettings } from '../../api/settings';
import { getProject, updateProject } from '../../api/project';

export const WriterLayout = ({ auPath, onNavigate }: { auPath: string, onNavigate: (page: string) => void }) => {
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  const [isDirtyOpen, setDirtyOpen] = useState(false);

  // Data state
  const [state, setState] = useState<StateInfo | null>(null);
  const [currentContent, setCurrentContent] = useState('');
  const [unresolvedFacts, setUnresolvedFacts] = useState<FactInfo[]>([]);
  const [focusSelection, setFocusSelection] = useState<string>('free');

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [generatedWith, setGeneratedWith] = useState<any>(null);
  const [budgetReport, setBudgetReport] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [instructionText, setInstructionText] = useState('');

  // Settings
  const [sessionModel, setSessionModel] = useState('deepseek-chat');
  const [sessionTemp, setSessionTemp] = useState(1.0);
  const [sessionTopP, setSessionTopP] = useState(0.95);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stateData, factsData, proj, settings] = await Promise.all([
        getState(auPath).catch(() => null),
        listFacts(auPath, 'unresolved').catch(() => []),
        getProject(auPath).catch(() => null),
        getSettings().catch(() => null),
      ]);
      setState(stateData);
      setUnresolvedFacts(factsData);

      // Initialize defaults based on settings hierarchy
      let defModel = 'deepseek-chat';
      let defTemp = 1.0;
      let defTopP = 0.95;

      if (settings?.default_llm?.model) {
        defModel = settings.default_llm.model;
        const gParams = settings.model_params?.[defModel];
        if (gParams) { defTemp = gParams.temperature; defTopP = gParams.top_p; }
      }
      
      if (proj?.llm?.model) {
        defModel = proj.llm.model;
      }
      if (proj?.model_params_override?.[defModel]) {
        defTemp = proj.model_params_override[defModel].temperature;
        defTopP = proj.model_params_override[defModel].top_p;
      }

      setSessionModel(defModel);
      setSessionTemp(defTemp);
      setSessionTopP(defTopP);

      if (stateData && stateData.current_chapter > 1) {
        const latestNum = stateData.current_chapter - 1;
        try {
          const content = await getChapterContent(auPath, latestNum);
          setCurrentContent(typeof content === 'string' ? content : '');
        } catch { setCurrentContent('（章节内容加载失败）'); }
      }
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [auPath]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveGlobalParams = async () => {
    try {
      const settings = await getSettings();
      settings.model_params[sessionModel] = { temperature: sessionTemp, top_p: sessionTopP };
      await updateSettings('./fandoms', settings);
      alert('已保存参数到全局配置');
    } catch (e: any) {
      setError('保存全局配置失败: ' + e.message);
    }
  };

  const handleSaveAuParams = async () => {
    try {
      const proj = await getProject(auPath);
      if (!proj.model_params_override) proj.model_params_override = {};
      proj.model_params_override[sessionModel] = { temperature: sessionTemp, top_p: sessionTopP };
      await updateProject(auPath, proj as any);
      alert('已保存附加参数到本 AU 独立配置');
    } catch (e: any) {
      setError('保存 AU 配置失败: ' + e.message);
    }
  };

  const handleGenerate = async (inputType: 'continue' | 'instruction') => {
    if (isGenerating || !state) return;
    setIsGenerating(true);
    setStreamText('');
    setError(null);

    try {
      const userInput = inputType === 'instruction' && instructionText.trim()
        ? instructionText.trim()
        : '继续';

      for await (const event of generateChapter({
        au_path: auPath,
        chapter_num: state.current_chapter,
        user_input: userInput,
        input_type: inputType,
        session_llm: sessionModel ? { mode: 'api', model: sessionModel } : undefined,
        session_params: { temperature: sessionTemp, top_p: sessionTopP },
      })) {
        if (event.event === 'token') {
          setStreamText(prev => prev + (event.data.text || ''));
        } else if (event.event === 'done') {
          setDraftLabel(event.data.draft_label);
          setGeneratedWith(event.data.generated_with);
          setBudgetReport(event.data.budget_report);
        } else if (event.event === 'error') {
          setError(event.data.message);
        }
      }
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConfirm = async () => {
    if (!draftLabel || !state) return;
    try {
      const draftId = `ch${String(state.current_chapter).padStart(4, '0')}_draft_${draftLabel}.md`;
      await confirmChapter(auPath, state.current_chapter, draftId, generatedWith);
      setStreamText('');
      setDraftLabel('');
      await loadData();
    } catch (e: any) {
      setError(e.message || '确认失败');
    }
  };

  const handleUndo = async () => {
    try {
      await undoChapter(auPath);
      setStreamText('');
      setDraftLabel('');
      await loadData();
    } catch (e: any) {
      setError(e.message || '撤销失败');
    }
  };

  const handleFocusChange = async (value: string) => {
    setFocusSelection(value);
    try {
      const ids = value === 'free' ? [] : [value];
      await setChapterFocus(auPath, ids);
    } catch (e: any) {
      setError(e.message || '设置焦点失败');
    }
  };

  const displayContent = streamText || currentContent;
  const currentChapter = state?.current_chapter || 1;
  const metaModel = generatedWith?.model || sessionModel;
  const metaChars = generatedWith?.char_count || displayContent.length;
  const metaDuration = generatedWith?.duration_ms ? `${(generatedWith.duration_ms / 1000).toFixed(1)}s` : '—';

  const contextLayers = budgetReport ? [
    { layer: 'P0', label: 'Pinned', percent: Math.max(1, Math.round((budgetReport.system_tokens / (budgetReport.total_input_tokens || 1)) * 100)), color: 'bg-error/70' },
    { layer: 'C.', label: 'Context', percent: Math.max(1, Math.round((budgetReport.context_tokens / (budgetReport.total_input_tokens || 1)) * 100)), color: 'bg-info/70' },
  ] : [
    { layer: 'P0', label: 'Pinned', percent: 10, color: 'bg-error/70' },
    { layer: 'P2', label: '最近章节', percent: 35, color: 'bg-info/70' },
    { layer: 'P3', label: '事实表', percent: 20, color: 'bg-accent/70' },
  ];

  return (
    <>
      <main className="flex-1 flex flex-col min-w-0 bg-background relative transition-colors duration-200">
        <header className="h-12 flex items-center justify-between px-6 border-b border-black/5 dark:border-white/5 text-xs text-text/50">
          <div className="flex items-center gap-4">
            <span>{metaModel} · T{sessionTemp}</span>
            <span>{metaChars} 字</span>
            <span>{metaDuration}</span>
          </div>
          <div className="flex items-center gap-2">
            {isGenerating && <Tag variant="warning" className="mr-2">生成中…</Tag>}
            <Button variant="ghost" size="sm" className="h-8 text-warning" onClick={() => setDirtyOpen(true)} title="Simulate Dirty State">
               <AlertCircle size={16} />
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setExportOpen(true)} title="Export">
               <FileUp size={16} />
            </Button>
            <ThemeToggle />
          </div>
        </header>

        {error && (
          <div className="mx-6 mt-2 p-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-xs flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto w-full flex justify-center pb-24">
          <div className="w-full max-w-2xl px-8 py-12 text-lg font-serif leading-loose text-text/90">
            {loading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-accent" size={24} /></div>
            ) : displayContent ? (
              displayContent.split('\n').filter(Boolean).map((para: string, i: number) => (
                <p key={i} className={`mb-6 indent-8 ${streamText && !draftLabel ? 'opacity-80' : ''}`}>{para}</p>
              ))
            ) : (
              <p className="text-text/30 text-center py-20">输入指令或点击“续写”开始创作</p>
            )}
            {isGenerating && <span className="inline-block w-0.5 h-5 bg-accent animate-pulse" />}
          </div>
        </div>

        <footer className="absolute bottom-0 w-full shrink-0 border-t border-black/10 dark:border-white/10 p-4 bg-surface/50 backdrop-blur-md flex flex-col gap-3">
          {draftLabel && (
            <div className="flex items-center justify-between max-w-3xl w-full mx-auto">
              <div className="flex items-center gap-2">
                <span className="text-xs font-sans text-text/50">草稿 {draftLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-8 text-error/80 hover:text-error hover:bg-error/10" onClick={() => { setStreamText(''); setDraftLabel(''); }}>丢弃草稿</Button>
                <Button variant="secondary" size="sm" className="h-8" onClick={() => handleGenerate('continue')} disabled={isGenerating}>再生成一次</Button>
                <Button variant="primary" size="sm" className="h-8 gap-1" onClick={handleConfirm}><Check size={16} /> 确认这一章</Button>
              </div>
            </div>
          )}

          <div className="max-w-3xl w-full mx-auto">
            <input
              type="text"
              placeholder="输入指令（如：让角色道歉）或留空直接续写…"
              value={instructionText}
              onChange={e => setInstructionText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !isGenerating) handleGenerate(instructionText.trim() ? 'instruction' : 'continue'); }}
              className="w-full h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-background text-sm focus:ring-2 focus:ring-accent/50 outline-none"
            />
          </div>

          <div className="flex items-center justify-between max-w-3xl w-full mx-auto mt-2 pt-2 border-t border-black/5 dark:border-white/5">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="text-text/60 hover:text-text" onClick={handleUndo} disabled={currentChapter <= 1}>
                <Undo2 size={16} className="mr-2" /> 撤销最新一章
              </Button>
              <Button variant="ghost" size="sm" className="text-text/60 hover:text-text" onClick={() => onNavigate('facts')}>
                <BookOpen size={16} className="mr-1" /> 事实表
              </Button>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="w-32 shadow-medium" onClick={() => handleGenerate('instruction')} disabled={isGenerating || !instructionText.trim()}>指令</Button>
              <Button variant="primary" className="w-32 shadow-medium" onClick={() => handleGenerate('continue')} disabled={isGenerating}>
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : '续写'}
              </Button>
            </div>
          </div>
        </footer>
      </main>

      <Sidebar position="right" width="320px" isCollapsed={rightCollapsed} onToggle={() => setRightCollapsed(!rightCollapsed)} className="flex flex-col bg-surface/50 border-l border-black/10 dark:border-white/10">
        <div className="flex-1 overflow-y-auto p-5 space-y-8">
          <section>
            <h3 className="text-xs font-sans font-medium mb-3 text-text/70 tracking-wide uppercase">本章推进焦点</h3>
            <div className="space-y-1">
              <label className="flex items-start gap-2 p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-colors">
                <input type="radio" name="focus" className="mt-1 accent-accent" checked={focusSelection === 'free'} onChange={() => handleFocusChange('free')} />
                <span className="text-sm">自由发挥</span>
              </label>
              {unresolvedFacts.map(f => (
                <label key={f.id} className="flex items-start gap-2 p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-colors">
                  <input type="radio" name="focus" className="mt-1 accent-accent" checked={focusSelection === String(f.id)} onChange={() => handleFocusChange(String(f.id))} />
                  <div className="flex flex-col">
                    <span className="text-sm">{f.content_clean}</span>
                    <Tag variant="warning" className="mt-1.5 w-fit">unresolved</Tag>
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-sans font-medium mb-3 text-text/70 tracking-wide uppercase">Context 可视化</h3>
            <div className="space-y-3">
              {contextLayers.map(item => (
                <div key={item.layer} className="flex items-center gap-2 text-xs">
                  <span className="w-6 font-mono text-text/50">{item.layer}</span>
                  <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden flex">
                    <div className={`${item.color} h-full`} style={{ width: `${item.percent}%` }} />
                  </div>
                  <span className="w-8 text-right text-text/50 font-mono">{item.percent}%</span>
                </div>
              ))}
            </div>
          </section>

          <section className="pt-4 border-t border-black/10 dark:border-white/10">
            <SettingsPanel
              model={sessionModel} onModelChange={setSessionModel}
              temperature={sessionTemp} onTemperatureChange={setSessionTemp}
              topP={sessionTopP} onTopPChange={setSessionTopP}
              onSaveGlobal={handleSaveGlobalParams} onSaveAu={handleSaveAuParams}
            />
          </section>
        </div>
      </Sidebar>

      <ExportModal isOpen={isExportOpen} onClose={() => setExportOpen(false)} />
      <DirtyModal isOpen={isDirtyOpen} onClose={() => setDirtyOpen(false)} auPath={auPath} chapterNum={currentChapter} onResolved={() => { setDirtyOpen(false); loadData(); }} />
    </>
  );
};
