# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Bilingual prompt routing.

Usage:
    from core.prompts import get_prompts
    P = get_prompts("en")  # or "zh"
    P.SYSTEM_NOVELIST      # → "You are a professional fiction writer."
"""

from __future__ import annotations

from types import ModuleType

from . import _keys


def get_prompts(language: str = "zh") -> ModuleType:
    """Return the prompt module for the given language.

    Validates that all keys defined in ``_keys.REQUIRED_KEYS`` are present.
    Raises ``RuntimeError`` on startup if any key is missing — this is
    intentional so missing translations are caught immediately, not at
    generation time.
    """
    if language == "en":
        from . import en as mod
    else:
        from . import zh as mod

    missing = [k for k in _keys.REQUIRED_KEYS if not hasattr(mod, k)]
    if missing:
        raise RuntimeError(
            f"Prompt module '{language}' is missing {len(missing)} required key(s): "
            f"{', '.join(missing[:10])}{'...' if len(missing) > 10 else ''}"
        )

    return mod
