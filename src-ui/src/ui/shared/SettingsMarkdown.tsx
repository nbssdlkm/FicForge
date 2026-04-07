/**
 * 设定文件 Markdown 渲染组件。
 *
 * 与 ChapterMarkdown（小说正文专用）不同，这里渲染完整的 Markdown 子集：
 * 标题、加粗/斜体、列表、分隔线、代码块。
 * 用于 Fandom/AU 设定文件预览和 Facts 内容展示。
 */

import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';

const components: Components = {
  h1: ({ children }) => <h1 className="text-xl font-bold mt-6 mb-3 text-text">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-bold mt-5 mb-2 text-text">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-bold mt-4 mb-2 text-text/90">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-bold mt-3 mb-1 text-text/80">{children}</h4>,
  h5: ({ children }) => <h5 className="text-sm font-semibold mt-2 mb-1 text-text/70">{children}</h5>,
  h6: ({ children }) => <h6 className="text-xs font-semibold mt-2 mb-1 text-text/60">{children}</h6>,
  p: ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>,
  hr: () => <hr className="my-5 border-t border-black/10 dark:border-white/10" />,
  ul: ({ children }) => <ul className="mb-3 pl-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 pl-5 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-bold text-text">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-accent/40 pl-4 my-3 text-text/70 italic">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="bg-black/5 dark:bg-white/5 rounded-lg p-3 my-3 overflow-x-auto text-xs">{children}</pre>
  ),
  code: ({ children, className }) => {
    // Inline code (no language class) vs block code (has language class or is inside pre)
    if (className) return <code className={className}>{children}</code>;
    return <code className="bg-black/5 dark:bg-white/5 rounded px-1.5 py-0.5 text-xs font-mono">{children}</code>;
  },
};

/** Strip YAML frontmatter (---\n...\n---) from content before rendering */
function stripFrontmatter(text: string): string {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? text.slice(match[0].length) : text;
}

export function SettingsMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm text-text/85">
      <Markdown components={components}>
        {stripFrontmatter(content)}
      </Markdown>
    </div>
  );
}
