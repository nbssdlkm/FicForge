# FicForge API 契约速查表

> 50 个端点，基于 API-ALIGNMENT 审计（2026-04-01 更新）。
> 参数标注：(q) = query, (b) = body, (p) = path
> 本文档为前端开发唯一参考，后端变更时必须同步更新。

---

## Lore — /api/v1/lore

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| POST | /read | au_path\|fandom_path, category, filename (b) | {content} |
| PUT | / | au_path\|fandom_path, category, filename, content (b) | {status, path} |
| DELETE | / | au_path\|fandom_path, category, filename (b) | {status, trash_id, deleted} |
| GET | /content | category, filename, au_path\|fandom_path (q) | {content} |
| GET | /list | category, au_path\|fandom_path (q) | {files: [{name, filename}]} |
| POST | /import-from-fandom | fandom_path, au_path, filenames (b) | {status, imported, skipped} |

---

## Fandoms — /api/v1/fandoms

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| GET | / | data_dir (q) | [{name, dir_name, aus}] |
| POST | / | name, data_dir (b) | {name, dir_name, path} — 重名 409 `FANDOM_ALREADY_EXISTS` |
| GET | /{name}/aus | {name} (p), data_dir (q) | [aus] |
| POST | /{name}/aus | {name} (p), name, fandom_path (b) | {name, path} — 重名 409 `AU_ALREADY_EXISTS` |
| GET | /{name}/files | {name} (p), data_dir (q) | {characters, worldbuilding} |
| GET | /{name}/files/{cat}/{file} | {name}, {cat}, {file} (p) | {filename, category, content} |
| DELETE | /{name} | {name} (p), data_dir (q) | {status, trash_id, deleted} |
| DELETE | /{name}/aus/{au} | {name}, {au} (p), data_dir (q) | {status, trash_id, deleted} |
| PUT | /{name}/rename | {name} (p), new_name (b) | {status, old_name, new_name, new_dir} — 重名 409 `ALREADY_EXISTS` |
| PUT | /{name}/aus/{au}/rename | {name}, {au} (p), new_name (b) | {status, old_name, new_name, new_dir} — 重名 409 `ALREADY_EXISTS` |

---

## Project — /api/v1/project

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| GET | / | au_path (q) | {project_id, name, fandom, llm, writing_style, cast_registry, ...} |
| PUT | / | au_path (q), payload (b) | {status, revision} |
| POST | /pinned | au_path (q), text (b) | {status, revision} |
| DELETE | /pinned/{index} | {index} (p), au_path (q) | {status, revision} |

---

## Chapters — /api/v1/chapters

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| GET | / | au_path (q) | [{chapter_num, chapter_id, confirmed_at, content_hash}] |
| GET | /{num} | {num} (p), au_path (q) | {au_id, chapter_num, content, provenance, ...} |
| GET | /{num}/content | {num} (p), au_path (q) | {content} |
| POST | /confirm | au_path, chapter_num, draft_id, generated_with (b, optional), content (b, optional) | {chapter_id, chapter_num, current_chapter} |
| POST | /undo | au_path (b) | {undone_chapter_num, current_chapter} |
| POST | /dirty/resolve | au_path, chapter_num, confirmed_fact_changes (b) | {chapter_num, is_latest} |

---

## Drafts — /api/v1/drafts

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| GET | / | au_path (q), chapter_num (q) | [{draft_label, filename}] |
| GET | /{label} | {label} (p), au_path (q), chapter_num (q) | {au_id, chapter_num, variant, content, generated_with} |
| DELETE | / | au_path (q), chapter_num (q), label (q, optional) | {deleted_count} |

---

## Facts — /api/v1/facts

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| GET | / | au_path (q), status (q, optional), chapter (q, optional), characters (q, optional) | [{id, content_raw, content_clean, status, type, ...}] |
| POST | / | au_path, chapter_num, fact_data (b) | {fact_id} |
| PUT | /{fact_id} | {fact_id} (p), au_path, updated_fields (b) | {fact_id, revision} |
| PATCH | /{fact_id}/status | {fact_id} (p), au_path, new_status, chapter_num (b) | {fact_id, status} |
| POST | /extract | au_path, chapter_num (b), session_llm (b, optional), session_params (b, optional) | {facts: [...]} |

---

## Generate — /api/v1/generate

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| POST | /stream | au_path, chapter_num, user_input, input_type (b), session_llm (b, optional), session_params (b, optional) | SSE: context_summary → token* → done |

**input_type**：`"continue"` 或 `"instruction"`（默认 `"continue"`）。

**SSE 事件顺序**：
1. `event: context_summary` — ContextSummary JSON（可能缺失，前端需容错）
2. `event: token` — `{text: "..."}` 逐 token 推送
3. `event: done` — `{draft_label, generated_with, budget_report}` 生成完成
4. `event: error` — `{error_code, message, actions, partial_draft_label}` 生成失败

---

## Settings — /api/v1/settings

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| GET | / | (无) | {default_llm, model_params, embedding, app, license} |
| PUT | / | payload (b) | {status} |
| POST | /test-connection | mode, model, api_base, api_key, local_model_path, ollama_model (b, 按 mode 选填) | {success, model, message, error_code} |
| POST | /test-embedding | mode, model, api_base, api_key (b) | {success, model, message, error_code} |

**注意**：test-connection 和 test-embedding 失败时也返回 200，`success=false` + `error_code`。

**test-connection mode 值**：
- `"api"` — 需要 model, api_base, api_key
- `"ollama"` — 需要 api_base（默认 localhost:11434）, ollama_model
- `"local"` — 需要 local_model_path

---

## Settings Chat — /api/v1/settings-chat

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| POST | / | base_path, mode, messages (b), fandom_path (b, optional), session_llm (b, optional) | {content, tool_calls} |

**mode**：`"au"` → 9 个 tool，`"fandom"` → 4 个 tool。
**base_path**（非 au_path）：因为 mode=fandom 时指向 Fandom 路径。

---

## State — /api/v1/state

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| GET | / | au_path (q) | {current_chapter, characters_last_seen, chapter_focus, ...} |
| PUT | /chapter-focus | au_path, focus_ids (b) | {chapter_focus} |
| POST | /recalc | au_path (b) | {characters_last_seen, last_scene_ending, last_confirmed_chapter_focus, chapters_scanned, cleaned_dirty_count, cleaned_focus_count} |

---

## Import / Export — /api/v1/import, /api/v1/export

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| POST | /import/upload | file (form) | {chapters, split_method, total_chapters} |
| POST | /import/confirm | au_path, chapters, split_method (b, optional), cast_registry (b, optional), character_aliases (b, optional) | {total_chapters, split_method, characters_found, state_initialized} |
| GET | /export | au_path, format, start, end, include_title, include_chapter_num (q, 后四项 optional) | File download |

**export 参数默认值**：`start=1`, `end=全部`, `format="txt"`, `include_title=true`, `include_chapter_num=true`。

---

## Trash — /api/v1/trash

| Method | Path | 参数 | 返回 |
|--------|------|------|------|
| GET | / | au_path (q) | [{trash_id, original_path, entity_type, deleted_at, ...}] |
| POST | /restore | trash_id, au_path (b) | {status, restored: {...}} |
| DELETE | /purge | au_path (q), max_age_days (q, optional) | {status, purged_count, purged} |
| DELETE | /{trash_id} | {trash_id} (p), au_path (q) | {status, deleted: {...}} |

**purge**：`max_age_days=0` → 强制清空全部；不传 → 只清已过期（默认 30 天）。`max_age_days` 不能为负数。

---

## 参数命名约定

| 参数 | 含义 | 使用范围 |
|------|------|---------|
| `au_path` | AU 目录路径 | 大部分端点（~25 个） |
| `data_dir` | 数据根目录 | fandoms 路由（9 个） |
| `base_path` | Fandom 或 AU 路径 | settings-chat（1 个） |
| ~~scope+path~~ | **deprecated**，被 au_path 替代 | trash（兼容保留） |

---

## 错误响应统一格式

所有非 SSE 端点的错误响应：

```json
{
  "error_code": "invalid_api_key",
  "message": "密钥验证失败",
  "actions": ["change_key", "check_docs"]
}
```

SSE 端点（generate/stream）的错误通过 `event: error` 推送同格式 JSON。
