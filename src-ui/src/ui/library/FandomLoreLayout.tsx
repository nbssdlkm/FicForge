import { useState, useEffect } from 'react';
import { Button } from '../shared/Button';
import { Input, Textarea } from '../shared/Input';
import { Tag } from '../shared/Tag';
import { Modal } from '../shared/Modal';
import { Search, Plus, ArrowLeft, FileText, ChevronDown, ChevronRight, Folder, Loader2, Trash2 } from 'lucide-react';
import { saveLore, deleteLore } from '../../api/lore';
import { listFandomFiles, readFandomFile, type FandomFileEntry } from '../../api/fandoms';

export const FandomLoreLayout = ({ fandomPath, onNavigate }: { fandomPath?: string, onNavigate: (page: string) => void }) => {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    core_characters: true,
    worldbuilding: true,
  });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('core_characters');
  const [editorContent, setEditorContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [characterFiles, setCharacterFiles] = useState<FandomFileEntry[]>([]);
  const [worldbuildingFiles, setWorldbuildingFiles] = useState<FandomFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalCategory, setCreateModalCategory] = useState<'core_characters' | 'core_worldbuilding'>('core_characters');
  const [createName, setCreateName] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const fandomName = fandomPath?.split('/').pop() || 'Unknown Fandom';

  useEffect(() => {
    if (!fandomPath) return;
    setFilesLoading(true);
    listFandomFiles(fandomName)
      .then(data => {
        setCharacterFiles(data.characters);
        setWorldbuildingFiles(data.worldbuilding);
      })
      .catch(() => {
        setCharacterFiles([]);
        setWorldbuildingFiles([]);
      })
      .finally(() => setFilesLoading(false));
  }, [fandomPath, fandomName]);

  const handleSelectFile = async (filename: string, category: string) => {
    setSelectedFile(filename.replace('.md', ''));
    setSelectedCategory(category);
    try {
      const result = await readFandomFile(fandomName, category, filename);
      setEditorContent(result.content);
    } catch {
      setEditorContent('');
    }
  };

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => ({ ...prev, [folder]: !prev[folder] }));
  };

  const openCreateModal = (category: 'core_characters' | 'core_worldbuilding') => {
    setCreateModalCategory(category);
    setCreateName('');
    setCreateModalOpen(true);
  };

  const handleCreateLore = async () => {
    const rawName = createName.trim();
    if (!rawName || !fandomPath) return;

    const slug = rawName.toLowerCase().replace(/\s+/g, '_');
    const label = createModalCategory === 'core_characters' ? '角色' : '世界观设定';
    const defaultContent = `# ${rawName}\n\n[${label}尚未编写]`;

    setIsSaving(true);
    setCreateModalOpen(false);
    try {
      await saveLore({
        fandom_path: fandomPath,
        category: createModalCategory,
        filename: `${slug}.md`,
        content: defaultContent,
      });
      setSelectedFile(slug);
      setSelectedCategory(createModalCategory);
      setEditorContent(defaultContent);
      if (createModalCategory === 'core_characters') {
        setCharacterFiles(prev => [...prev, { name: slug, filename: `${slug}.md` }]);
      } else {
        setWorldbuildingFiles(prev => [...prev, { name: slug, filename: `${slug}.md` }]);
      }
    } catch (e: any) {
      alert("创建失败: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveLore = async () => {
    if (!selectedFile || !fandomPath) return;
    setIsSaving(true);
    try {
      await saveLore({
        fandom_path: fandomPath,
        category: selectedCategory,
        filename: `${selectedFile}.md`,
        content: editorContent
      });
    } catch (e: any) {
      alert("保存失败: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteLore = async () => {
    if (!selectedFile || !fandomPath) return;
    setDeleteConfirmOpen(false);
    setIsSaving(true);
    try {
      await deleteLore({
        fandom_path: fandomPath,
        category: selectedCategory,
        filename: `${selectedFile}.md`,
      });
      if (selectedCategory === 'core_characters') {
        setCharacterFiles(prev => prev.filter(f => f.name !== selectedFile));
      } else {
        setWorldbuildingFiles(prev => prev.filter(f => f.name !== selectedFile));
      }
      setSelectedFile(null);
      setEditorContent('');
    } catch (e: any) {
      alert("删除失败: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <div className="flex h-screen bg-background text-text transition-colors duration-200 w-full overflow-hidden">
       <div className="w-[300px] md:w-[340px] shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-surface/50">
         <header className="p-4 border-b border-black/10 dark:border-white/10 flex flex-col gap-3 shrink-0 bg-surface">
           <div className="flex justify-between items-center">
             <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onNavigate('library')} className="p-1 h-8 w-8 text-text/60 hover:text-text rounded-full">
                  <ArrowLeft size={18} />
                </Button>
                <h1 className="font-serif text-lg font-bold">{fandomName} 设定库</h1>
             </div>
             <Button variant="ghost" size="sm" className="px-2" onClick={() => openCreateModal('core_characters')} disabled={isSaving}>
               {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16}/>}
             </Button>
           </div>
           <div className="relative">
             <Search className="absolute left-2.5 top-2 text-text/50" size={14} />
             <Input className="pl-8 h-8 text-xs placeholder:text-xs" placeholder="搜索文件或别称..." />
           </div>
         </header>

         <div className="flex-1 overflow-y-auto p-2 space-y-6 font-mono py-4">
           <div className="space-y-2">
             <div className="px-3 pb-1 text-[11px] font-sans font-bold text-text/40 uppercase tracking-widest flex justify-between items-center">
               <span>📚 根节点 Fandom 全局设定 (Global)</span>
             </div>
             <div>
               <div className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/80 font-bold font-sans" onClick={() => toggleFolder('core_characters')}>
                 {expandedFolders['core_characters'] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                 <Folder size={14} className="text-accent" fill="currentColor" fillOpacity={0.2} />
                 <span>core_characters</span>
               </div>
               {expandedFolders['core_characters'] && (
                 <div className="mt-1 space-y-0.5">
                   {filesLoading ? (
                     <div className="pl-6 py-2"><Loader2 size={14} className="animate-spin text-accent" /></div>
                   ) : characterFiles.length === 0 ? (
                     <p className="text-xs text-text/40 pl-6 py-2">尚未发现角色设定文件。</p>
                   ) : (
                     characterFiles.map(f => (
                       <div
                         key={f.filename}
                         className={`flex items-center gap-2 pl-6 pr-2 py-1.5 text-sm cursor-pointer rounded-md transition-colors ${
                           selectedFile === f.name && selectedCategory === 'core_characters'
                             ? 'bg-accent/10 text-accent font-semibold'
                             : 'hover:bg-black/5 dark:hover:bg-white/5 text-text/70'
                         }`}
                         onClick={() => handleSelectFile(f.filename, 'core_characters')}
                       >
                         <FileText size={13} />
                         <span>{f.name}</span>
                       </div>
                     ))
                   )}
                 </div>
               )}
             </div>
             <div>
               <div className="flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-text/80 font-bold font-sans" onClick={() => toggleFolder('worldbuilding')}>
                 <div className="flex items-center gap-2">
                   {expandedFolders['worldbuilding'] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                   <Folder size={14} className="text-warning" fill="currentColor" fillOpacity={0.2} />
                   <span>worldbuilding</span>
                 </div>
                 <Button variant="ghost" size="sm" className="p-0 h-6 w-6" onClick={(e) => { e.stopPropagation(); openCreateModal('core_worldbuilding'); }}>
                   <Plus size={12} />
                 </Button>
               </div>
               {expandedFolders['worldbuilding'] && (
                 <div className="mt-1 space-y-0.5">
                   {filesLoading ? (
                     <div className="pl-6 py-2"><Loader2 size={14} className="animate-spin text-accent" /></div>
                   ) : worldbuildingFiles.length === 0 ? (
                     <p className="text-xs text-text/40 pl-6 py-2">暂无世界观设定文件。</p>
                   ) : (
                     worldbuildingFiles.map(f => (
                       <div
                         key={f.filename}
                         className={`flex items-center gap-2 pl-6 pr-2 py-1.5 text-sm cursor-pointer rounded-md transition-colors ${
                           selectedFile === f.name && selectedCategory === 'core_worldbuilding'
                             ? 'bg-accent/10 text-accent font-semibold'
                             : 'hover:bg-black/5 dark:hover:bg-white/5 text-text/70'
                         }`}
                         onClick={() => handleSelectFile(f.filename, 'core_worldbuilding')}
                       >
                         <FileText size={13} />
                         <span>{f.name}</span>
                       </div>
                     ))
                   )}
                 </div>
               )}
             </div>
           </div>
         </div>
       </div>

       <div className="flex-1 flex flex-col bg-background relative">
          <header className="h-14 border-b border-black/10 dark:border-white/10 flex items-center px-6 justify-between shrink-0 bg-surface/30">
            {selectedFile ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold opacity-70">{selectedFile}.md</span>
                  <Tag variant={selectedCategory === 'core_characters' ? 'success' : 'warning'}>
                    {selectedCategory === 'core_characters' ? 'Core Character' : 'Worldbuilding'}
                  </Tag>
                </div>
                <div className="flex items-center gap-4">
                   <span className="text-[11px] text-text/40 bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md hidden xl:block">
                     Fandom 原著 DNA 模板。仅供 AI 设定模式参考，不直接注入 AU。
                   </span>
                   <Button variant="ghost" size="sm" className="h-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteConfirmOpen(true)} disabled={isSaving}>
                     <Trash2 size={14} />
                   </Button>
                   <Button variant="primary" size="sm" className="h-8 w-24" onClick={handleSaveLore} disabled={isSaving}>
                     {isSaving ? <Loader2 size={14} className="animate-spin" /> : '全局覆盖保存'}
                   </Button>
                </div>
              </>
            ) : (
              <span className="font-mono text-sm opacity-40">未选择设定文件</span>
            )}
          </header>

          <div className="flex-1 overflow-y-auto p-8 lg:p-12 w-full max-w-4xl mx-auto flex flex-col gap-6">
            {selectedFile ? (
              <>
                <div className="grid grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-text/90">标准译名 / 全名</label>
                    <Input defaultValue={selectedFile} className="h-10 font-sans text-base" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-text/90">别名 / 别称</label>
                    <Input placeholder="用逗号分隔" className="h-10 font-sans" />
                    <p className="text-xs text-text/50">用逗号分隔。</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  <label className="text-sm font-bold text-text/90">Markdown 纯文本设定基底</label>
                  <Textarea
                    value={editorContent}
                    onChange={e => setEditorContent(e.target.value)}
                    className="font-mono flex-1 min-h-[300px] text-sm leading-relaxed bg-surface/30 p-4 resize-y" 
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full opacity-30 mt-20">
                <FileText size={48} className="mb-4" />
                <p>在左侧列表中选择角色以编辑设定。</p>
              </div>
            )}
          </div>
       </div>

       <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title={createModalCategory === 'core_characters' ? '新建角色设定' : '新建世界观设定'}>
         <div className="flex flex-col gap-4">
           <Input
             placeholder={createModalCategory === 'core_characters' ? '角色名 (如: Harry Potter)' : '设定名 (如: 魔法体系)'}
             value={createName}
             onChange={e => setCreateName(e.target.value)}
             className="h-10"
             autoFocus
           />
           <div className="flex justify-end gap-2">
             <Button variant="ghost" onClick={() => setCreateModalOpen(false)}>取消</Button>
             <Button variant="primary" onClick={handleCreateLore} disabled={!createName.trim()}>创建</Button>
           </div>
         </div>
       </Modal>

       <Modal isOpen={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title="确认删除设定文件">
         <div className="space-y-4">
           <p className="text-sm text-text/80">确定要删除「<strong>{selectedFile}.md</strong>」吗？此操作不可撤销。</p>
           <div className="flex justify-end gap-2">
             <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>取消</Button>
             <Button variant="primary" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDeleteLore}>确认删除</Button>
           </div>
         </div>
       </Modal>
    </div>
  );
};
