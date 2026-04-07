# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""生成来源与统计快照。参见 PRD §2.6.4 / §3.4 frontmatter。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class GeneratedWith:
    """章节/草稿的生成来源与统计快照。

    Phase 1 写入，UI 可选展示。
    """

    mode: str = ""          # api / local / ollama
    model: str = ""
    temperature: float = 0.0
    top_p: float = 0.0
    input_tokens: int = 0   # 本次组装的输入 token 数
    output_tokens: int = 0  # 模型实际输出 token 数
    char_count: int = 0     # 正文字数（不含 frontmatter）
    duration_ms: int = 0    # 生成耗时（毫秒）
    generated_at: str = ""  # ISO 8601
