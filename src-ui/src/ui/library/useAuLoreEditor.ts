// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useCallback, useEffect, useRef, useState } from "react";
import { readLore } from "../../api/engine-client";
import { useActiveRequestGuard } from "../../hooks/useActiveRequestGuard";
import {
  buildDefaultCharacterContent,
  buildDefaultWorldbuildingContent,
  parseAliasesFromContent,
  type LoreCategory,
  type LoreFileEntry,
} from "./lore-utils";

function buildDefaultContent(name: string, category: LoreCategory): string {
  return category === "worldbuilding" ? buildDefaultWorldbuildingContent(name) : buildDefaultCharacterContent(name);
}

/**
 * useAuLoreEditor — 当前打开文件的编辑器状态（选中/正文/别名/预览开关）
 * 与列表侧 UI 状态（分类/搜索词/桌面折叠夹）。
 *
 * reconcile 只随 loadKey 触发（loadKey = useAuLoreData 每次全量加载成功 +1），
 * 文件列表经 ref shim 读取（hook 规则 4）：列表局部增删不该触发重读打开的文件。
 * 分类/搜索词/折叠夹/预览开关有意不随切 AU 重置（沿用旧行为：会话内偏好）。
 */
export function useAuLoreEditor(
  auPath: string,
  files: LoreFileEntry[],
  worldbuildingFiles: LoreFileEntry[],
  loadKey: number,
) {
  const readGuard = useActiveRequestGuard(auPath);

  const [selectedCategory, setSelectedCategory] = useState<LoreCategory>("characters");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  // 最近一次与磁盘一致的正文（打开/新建/保存成功时更新）。脏判据 = 与 editorContent 不等；
  // reconcile 重读仅在不脏时执行 —— 否则「打开文件→编辑未保存→导入成功触发 reload」会
  // 重读磁盘静默覆盖未保存编辑（2026-07-10 合并审阅确认的存量数据丢失路径）。
  const [savedContent, setSavedContent] = useState("");
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAlias, setNewAlias] = useState("");
  const [previewMode, setPreviewMode] = useState(true);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    characters: true,
    worldbuilding: false,
  });

  const listsRef = useRef({ files, worldbuildingFiles });
  listsRef.current = { files, worldbuildingFiles };

  // markContentSaved 在 actions 的 async 收尾里被调，经 ref 读最新正文（闭包会陈旧）
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;

  // 切 AU：关掉上一篇打开的文件
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——体内全是 setter（非依赖），仅应随 auPath 变化关掉上一篇文件；biome 判 auPath 多余，删掉会导致切 AU 不再复位（残留上一篇打开的文件/正文）
  useEffect(() => {
    setSelectedFile(null);
    setEditorContent("");
    setSavedContent("");
    setAliases([]);
    setNewAlias("");
    setIsReadingFile(false);
  }, [auPath]);

  /** 打开文件并读取正文；characters 分类同步解析别名。分类跟随点击的列表项。 */
  // biome-ignore lint/correctness/useExhaustiveDependencies: 有意省依赖——hook 规则 4 ref-shim/边沿触发语义（见邻近注释）
  const openFile = useCallback(
    async (name: string, category: LoreCategory) => {
      const token = readGuard.start();
      setSelectedCategory(category);
      setSelectedFile(name);
      setEditorContent("");
      setIsReadingFile(true);
      try {
        const result = await readLore({ au_path: auPath, category, filename: `${name}.md` });
        if (readGuard.isStale(token)) return;
        const content = result.content || buildDefaultContent(name, category);
        setEditorContent(content);
        setSavedContent(content);
        setAliases(category === "characters" ? parseAliasesFromContent(content) : []);
        setNewAlias("");
      } catch {
        if (readGuard.isStale(token)) return;
        const fallback = buildDefaultContent(name, category);
        setEditorContent(fallback);
        setSavedContent(fallback);
        // 读失败也要重置别名，否则残留上一个文件的别名、保存时被误写入
        setAliases(category === "characters" ? parseAliasesFromContent(fallback) : []);
        setNewAlias("");
      } finally {
        if (!readGuard.isStale(token)) {
          setIsReadingFile(false);
        }
      }
      // readGuard 为稳定引用，读文件只应随 auPath 变化重建
    },
    [auPath],
  );

  /** 关闭当前文件（移动端返回 / 删除后 / 列表刷新后文件已不存在）。 */
  const closeFile = useCallback(() => {
    setSelectedFile(null);
    setEditorContent("");
    setSavedContent("");
    setAliases([]);
    setNewAlias("");
  }, []);

  // 全量列表刷新后（导入成功 reload）：选中文件仍在且无未保存编辑 → 重读正文；
  // 有未保存编辑 → 保留内存内容不重读（用户编辑优先于磁盘回显）；已消失 → 关闭
  // biome-ignore lint/correctness/useExhaustiveDependencies: 有意省依赖——hook 规则 4 ref-shim/边沿触发语义（见邻近注释）
  useEffect(() => {
    if (loadKey === 0 || !selectedFile) return;
    const list = selectedCategory === "worldbuilding" ? listsRef.current.worldbuildingFiles : listsRef.current.files;
    if (list.some((file) => file.name === selectedFile)) {
      if (editorContent === savedContent) {
        void openFile(selectedFile, selectedCategory);
      }
    } else {
      closeFile();
    }
    // 只应由 loadKey 驱动；selectedFile/selectedCategory/脏判据 取触发时刻的值
  }, [loadKey]);

  /** 切分类 tab / 定位新建目标分类（仅切分类，不动已打开的文件——沿用旧行为）。 */
  const selectCategory = useCallback((category: LoreCategory) => setSelectedCategory(category), []);

  /** 桌面侧栏文件夹折叠开关。 */
  const toggleFolder = useCallback((folder: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folder]: !prev[folder] }));
  }, []);

  const showPreview = useCallback(() => setPreviewMode(true), []);
  const showEditor = useCallback(() => setPreviewMode(false), []);

  /** 回车/逗号确认输入中的别名（去重后入列）。 */
  const commitNewAlias = useCallback(() => {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    setAliases((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setNewAlias("");
  }, [newAlias]);

  /** 点别名 chip 的 × 移除。 */
  const removeAliasAt = useCallback((index: number) => {
    setAliases((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** 输入框为空时按退格，回删最后一个别名。 */
  const popLastAlias = useCallback(() => {
    setAliases((prev) => prev.slice(0, -1));
  }, []);

  /** 拖入 .txt/.md 文件，追加到正文末尾。 */
  const appendDroppedText = useCallback((text: string) => {
    setEditorContent((prev) => prev + "\n\n" + text);
  }, []);

  /** 新建成功：直接打开新文件进入编辑态（内容已知，不再读盘）。 */
  const applyCreated = useCallback((name: string, category: LoreCategory, content: string) => {
    setSelectedCategory(category);
    setSelectedFile(name);
    setEditorContent(content);
    setSavedContent(content);
    // 别名同步重置，否则新文件会带着上一个文件的别名、保存时被误写入
    setAliases(category === "characters" ? parseAliasesFromContent(content) : []);
    setNewAlias("");
    setPreviewMode(false);
  }, []);

  /** 保存成功后由 actions 调用：把当前正文标记为「与磁盘一致」（脏判据基线）。 */
  const markContentSaved = useCallback(() => {
    setSavedContent(editorContentRef.current);
  }, []);

  const clearSearch = useCallback(() => setSearchTerm(""), []);

  return {
    selectedCategory,
    selectedFile,
    editorContent,
    aliases,
    newAlias,
    previewMode,
    isReadingFile,
    searchTerm,
    expandedFolders,
    openFile,
    closeFile,
    selectCategory,
    toggleFolder,
    showPreview,
    showEditor,
    commitNewAlias,
    removeAliasAt,
    popLastAlias,
    appendDroppedText,
    applyCreated,
    markContentSaved,
    clearSearch,
    // 受控绑定 setter（hook 规则 5 例外①）
    setEditorContent, // 正文 textarea
    setNewAlias, // 别名输入框
    setSearchTerm, // 搜索框
  };
}
