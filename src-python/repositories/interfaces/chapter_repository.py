# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""ChapterRepository 抽象接口。

业务逻辑不得直接访问文件路径，必须通过此接口。
章节文件名 4 位补零转换封装在 Repository 内部（D-0014）。
参见 PRD §2.6.2。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from core.domain.chapter import Chapter


class ChapterRepository(ABC):
    """章节存储抽象接口。"""

    @abstractmethod
    def get(self, au_id: str, chapter_num: int) -> Chapter:
        """获取指定章节。chapter_num 为整型（D-0014）。"""
        ...

    @abstractmethod
    def save(self, chapter: Chapter) -> None:
        """保存章节（新建或覆盖）。"""
        ...

    @abstractmethod
    def delete(self, au_id: str, chapter_num: int) -> None:
        """删除指定章节。"""
        ...

    @abstractmethod
    def list_main(self, au_id: str) -> list[Chapter]:
        """列出 AU 下所有已确认主线章节，按章节号排序。"""
        ...

    @abstractmethod
    def exists(self, au_id: str, chapter_num: int) -> bool:
        """检查指定章节是否存在。"""
        ...

    @abstractmethod
    def get_content_only(self, au_id: str, chapter_num: int) -> str:
        """读取纯正文（剥离 frontmatter），用于上下文注入和向量化。"""
        ...

    @abstractmethod
    def backup_chapter(self, au_id: str, chapter_num: int) -> str:
        """备份章节到 chapters/backups/ 目录。

        覆盖已确认章节时自动调用（PRD §4.3）。
        版本号自增（ch{NNNN}_v{N}.md）。
        返回备份文件路径。
        """
        ...
