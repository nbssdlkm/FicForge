/**
 * 章节正文 Markdown 渲染组件（FIX-005A）。
 *
 * 只渲染小说正文需要的子集：
 * - *** / --- → 分隔线
 * - **粗体** → 粗体
 * - *斜体* → 斜体
 * - 段落换行
 *
 * 不渲染标题、代码块、列表等。
 */

import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';

const components: Components = {
  // 段落保持小说排版风格
  p: ({ children }) => <p className="mb-6 indent-8">{children}</p>,
  // 分隔线
  hr: () => <hr className="my-8 border-t border-black/15 dark:border-white/15" />,
  // 拦截标题、代码块、列表等 → 降级为段落
  h1: ({ children }) => <p className="mb-6 indent-8">{children}</p>,
  h2: ({ children }) => <p className="mb-6 indent-8">{children}</p>,
  h3: ({ children }) => <p className="mb-6 indent-8">{children}</p>,
  h4: ({ children }) => <p className="mb-6 indent-8">{children}</p>,
  h5: ({ children }) => <p className="mb-6 indent-8">{children}</p>,
  h6: ({ children }) => <p className="mb-6 indent-8">{children}</p>,
  pre: ({ children }) => <p className="mb-6 indent-8">{children}</p>,
  code: ({ children }) => <>{children}</>,
  ul: ({ children }) => <div className="mb-6">{children}</div>,
  ol: ({ children }) => <div className="mb-6">{children}</div>,
  li: ({ children }) => <p className="mb-2 indent-8">{children}</p>,
};

export function ChapterMarkdown({ content }: { content: string }) {
  return (
    <Markdown components={components}>
      {content}
    </Markdown>
  );
}
