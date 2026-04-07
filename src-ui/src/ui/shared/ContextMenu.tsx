// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * 自定义右键菜单（Tauri webview 不显示浏览器默认右键菜单）。
 * 在 input/textarea 上右键时显示剪切/复制/粘贴/全选。
 * 使用 Clipboard API + Selection API（不依赖已废弃的 execCommand）。
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n/useAppTranslation';

interface MenuState {
  x: number;
  y: number;
  target: HTMLInputElement | HTMLTextAreaElement;
}

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, target: target as HTMLInputElement | HTMLTextAreaElement });
    }
  }, []);

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', close);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', close);
    };
  }, [handleContextMenu, close]);

  const getSelection = (el: HTMLInputElement | HTMLTextAreaElement) => {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    return { start, end, text: el.value.substring(start, end) };
  };

  const replaceSelection = (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const before = el.value.substring(0, start);
    const after = el.value.substring(end);

    // 触发 React onChange
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    )?.set;
    nativeSetter?.call(el, before + text + after);
    el.dispatchEvent(new Event('input', { bubbles: true }));

    // 恢复光标位置
    const newPos = start + text.length;
    el.setSelectionRange(newPos, newPos);
    el.focus();
  };

  const handleCopy = () => {
    if (!menu) return;
    const { text } = getSelection(menu.target);
    if (text) navigator.clipboard.writeText(text);
    close();
  };

  const handleCut = () => {
    if (!menu) return;
    const { text } = getSelection(menu.target);
    if (text) {
      navigator.clipboard.writeText(text);
      replaceSelection(menu.target, '');
    }
    close();
  };

  const handlePaste = async () => {
    if (!menu) return;
    try {
      const text = await navigator.clipboard.readText();
      replaceSelection(menu.target, text);
    } catch {
      // Clipboard API 被拒绝时静默失败
    }
    close();
  };

  const handleSelectAll = () => {
    if (!menu) return;
    menu.target.setSelectionRange(0, menu.target.value.length);
    menu.target.focus();
    close();
  };

  return (
    <>
      {children}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-[100] bg-surface border border-black/15 dark:border-white/15 rounded-lg shadow-lg py-1 min-w-[120px] text-sm font-sans"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={e => e.preventDefault()}
        >
          <button className="w-full text-left px-4 py-1.5 hover:bg-accent/10 text-text/80" onClick={handleCut}>{t('contextMenu.cut')}</button>
          <button className="w-full text-left px-4 py-1.5 hover:bg-accent/10 text-text/80" onClick={handleCopy}>{t('contextMenu.copy')}</button>
          <button className="w-full text-left px-4 py-1.5 hover:bg-accent/10 text-text/80" onClick={handlePaste}>{t('contextMenu.paste')}</button>
          <div className="h-px bg-black/10 dark:bg-white/10 my-1" />
          <button className="w-full text-left px-4 py-1.5 hover:bg-accent/10 text-text/80" onClick={handleSelectAll}>{t('contextMenu.selectAll')}</button>
        </div>
      )}
    </>
  );
}
