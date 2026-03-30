import { useState, useEffect } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { Tag } from '../shared/Tag';
import { Settings, Save, Trash2, Plus, Loader2, AlertCircle } from 'lucide-react';
import { getProject, updateProject, type ProjectInfo } from '../../api/project';
import { getSettings, updateSettings } from '../../api/settings';
import { GlobalSettingsModal } from './GlobalSettingsModal';

export const AuSettingsLayout = ({ auPath }: { auPath: string }) => {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const [auModel, setAuModel] = useState('');
  const [auApiBase, setAuApiBase] = useState('');
  const [auApiKey, setAuApiKey] = useState('');

  useEffect(() => {
    if (!auPath) return;
    setLoading(true);
    Promise.all([
      getProject(auPath).catch(() => null),
      getSettings().catch(() => null),
    ]).then(([proj, settings]) => {
      setProject(proj);
      setGlobalSettings(settings);
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
          setAuModel(proj.llm.model);
          setAuApiBase(proj.llm.api_base || '');
          setAuApiKey(proj.llm.api_key || '');
        }
      }
    }).finally(() => setLoading(false));
  }, [auPath]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
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
             model: auModel,
             api_base: auApiBase,
             api_key: auApiKey
           };
        } else {
           // Clear it so it falls back to global
           payload.llm = { model: '', api_base: '', api_key: '' };
        }
        
        await updateProject(auPath, payload);
      }
      setSaving(false);
    } catch (e: any) {
      setError(e.message || '保存失败');
      setSaving(false);
    }
  };

  const addPinnedRule = () => setPinnedContext(prev => [...prev, '']);
  const removePinnedRule = (idx: number) => setPinnedContext(prev => prev.filter((_, i) => i !== idx));
  const updatePinnedRule = (idx: number, value: string) => setPinnedContext(prev => prev.map((v, i) => i === idx ? value : v));

  const removeCoreInclude = (idx: number) => setCoreIncludes(prev => prev.filter((_, i) => i !== idx));
  const addCoreInclude = () => {
    const file = window.prompt("请输入设定文件名 (如 magic_system.md):");
    if (file && file.trim()) {
      setCoreIncludes(prev => [...prev, file.trim()]);
    }
  };

  const auName = project?.name || auPath.split('/').pop() || 'Unknown AU';

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
                本 AU 模型与结构配置 <span className="text-lg font-normal opacity-50 ml-2">{auName}</span>
              </h1>
            </div>
            <Button variant="primary" className="w-24 shadow-md gap-2" onClick={handleSave} disabled={saving}>
              <Save size={16}/> {saving ? '...' : '保存'}
            </Button>
          </header>

          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {/* 1. 模型与 API 配置 */}
          <section className="space-y-4">
            <h2 className="text-lg font-sans font-bold text-accent border-l-4 border-accent pl-3">模型引擎配置 (LLM API Settings)</h2>
            <div className="bg-surface/50 p-6 rounded-xl border border-black/5 dark:border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                   <h3 className="text-sm font-bold text-text/90 mb-1">覆盖继承的全局 API 凭证 (Override Global Credentials)</h3>
                   <p className="text-xs text-text/50">默认继承全局 API 配置。如果需要为当前 AU 指定专属的模型或 Key（如特定的微调模型），请开启此项。</p>
                </div>
                <div className="flex items-center gap-3">
                   <Button variant="ghost" size="sm" onClick={() => setGlobalSettingsOpen(true)}>⚙️ 查看全局设置</Button>
                   <label className="relative inline-flex items-center cursor-pointer">
                     <input type="checkbox" className="sr-only peer" checked={isLlMOverride} onChange={e => setIsLlmOverride(e.target.checked)} />
                     <div className="w-9 h-5 bg-black/20 dark:bg-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                   </label>
                </div>
              </div>

              {isLlMOverride && (
                <div className="pt-4 border-t border-black/10 dark:border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-text/80">AU 专属模型 (Model)</label>
                    <Input value={auModel} onChange={e => setAuModel(e.target.value)} placeholder="如: deepseek-chat" className="h-9 text-sm" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                     <label className="text-xs font-bold text-text/80">API Key</label>
                     <Input type="password" value={auApiKey} onChange={e => setAuApiKey(e.target.value)} placeholder="sk-..." className="h-9 text-sm" />
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                     <label className="text-xs font-bold text-text/80">API Base URL</label>
                     <Input value={auApiBase} onChange={e => setAuApiBase(e.target.value)} placeholder="如: https://api.deepseek.com" className="h-9 text-sm" />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 2. 文风与结构控制 */}
          <section className="space-y-6">
            <h2 className="text-lg font-sans font-bold text-accent border-l-4 border-accent pl-3">文风与架构控制 (Writing Style)</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-surface/50 p-6 rounded-xl border border-black/5 dark:border-white/5">
              <div className="flex flex-col gap-4">
                 <div className="flex flex-col gap-2">
                   <label className="text-sm font-bold text-text/90">人称视角 (Perspective)</label>
                   <select value={perspective} onChange={e => setPerspective(e.target.value)} className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-background px-3 text-sm focus:ring-2 focus:ring-accent outline-none">
                     <option value="third_person">第三人称 (推荐)</option>
                     <option value="first_person">第一人称</option>
                   </select>
                 </div>
                 <div className="flex flex-col gap-2">
                   <label className="text-sm font-bold text-text/90">情绪风格 (Emotion Style)</label>
                   <select value={emotionStyle} onChange={e => setEmotionStyle(e.target.value)} className="h-10 rounded-md border border-black/20 dark:border-white/20 bg-background px-3 text-sm focus:ring-2 focus:ring-accent outline-none">
                     <option value="implicit">含蓄暗示 (Show, don't tell)</option>
                     <option value="explicit">直接表达 (Tell)</option>
                   </select>
                 </div>
                 <div className="flex flex-col gap-2">
                   <label className="text-sm font-bold text-text/90">期望单章长度限制</label>
                   <Input type="number" value={chapterLength} onChange={e => setChapterLength(parseInt(e.target.value) || 2000)} className="h-10 font-mono" />
                   <p className="text-xs text-text/50">控制单次续写的生成长度上限。</p>
                 </div>
              </div>

              <div className="flex flex-col gap-2 flex-1">
                 <label className="text-sm font-bold text-text/90">自定义文风提示词 (Custom Instructions)</label>
                 <Textarea 
                   value={customInstructions}
                   onChange={e => setCustomInstructions(e.target.value)}
                   placeholder="示例：多描写城市里的霓虹灯和环境噪音。对话需简短冷酷。"
                   className="font-serif min-h-[200px] text-sm leading-relaxed bg-background p-4 resize-y" 
                 />
              </div>
            </div>
          </section>

          {/* 3. 铁律 Pinned Context */}
          <section className="space-y-6">
            <h2 className="text-lg font-sans font-bold text-error border-l-4 border-error pl-3 flex justify-between items-center">
               <span>全局铁律 (Pinned Context)</span>
               <Button variant="secondary" size="sm" className="h-8 text-xs font-normal border-error/30 text-error hover:bg-error/10" onClick={addPinnedRule}>
                 <Plus size={14} className="mr-1"/> 新增一条
               </Button>
            </h2>
            <p className="text-sm text-text/60">这些规则被标识为最高优先级(P0)，会在任何一次生成中无条件塞入 prompt 顶部，请保持精简。</p>
            
            <div className="space-y-3">
               {pinnedContext.length === 0 ? (
                 <p className="text-sm text-text/40 text-center py-6">尚未设置任何铁律规则。点击"新增一条"来添加。</p>
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
            <h2 className="text-lg font-sans font-bold text-success border-l-4 border-success pl-3">常驻核心设定 (Core Includes)</h2>
            <p className="text-sm text-text/60">下列设定文件(P5)在每次生成时将被完全读取，不会仅依赖 RAG 检索。</p>
            
            <div className="flex gap-3 flex-wrap">
              {coreIncludes.length === 0 ? (
                <p className="text-sm text-text/40">尚未指定常驻文件。</p>
              ) : (
                coreIncludes.map((file, idx) => (
                  <Tag key={idx} variant="success" className="px-3 py-1.5 text-sm gap-2">
                    <span>{file}</span>
                    <button className="hover:text-success/50" onClick={() => removeCoreInclude(idx)}><Trash2 size={14}/></button>
                  </Tag>
                ))
              )}
              <Button variant="ghost" size="sm" className="h-8 border border-dashed border-success/30 text-success hover:bg-success/5" onClick={addCoreInclude}>
                <Plus size={14} className="mr-1"/> 添加设定文件
              </Button>
            </div>
          </section>

          {/* 5. Cast Registry (D-0022: unified characters list) */}
          {project?.cast_registry && (
            <section className="space-y-6">
              <h2 className="text-lg font-sans font-bold text-info border-l-4 border-info pl-3">角色注册表 (Cast Registry)</h2>
              <div className="bg-surface/50 p-4 rounded-xl border border-black/5 dark:border-white/5">
                <h3 className="text-xs font-bold text-text/60 uppercase mb-2">Characters</h3>
                {(project.cast_registry.characters || []).length === 0 ? (
                  <p className="text-xs text-text/40">无</p>
                ) : (
                  <div className="flex flex-wrap gap-1">{project.cast_registry.characters.map(c => <Tag key={c} variant="default" className="text-xs">{c}</Tag>)}</div>
                )}
              </div>
            </section>
          )}

          <div className="h-20"></div>
        </div>
      </main>
      
      <GlobalSettingsModal isOpen={isGlobalSettingsOpen} onClose={() => setGlobalSettingsOpen(false)} />
    </>
  );
};
