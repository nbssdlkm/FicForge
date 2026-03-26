# PRD → 开发任务切分方案

> 本文档将 PRD v2（3228 行）拆解为可执行的开发任务序列。
> 每个任务对应一个 Git 分支和一份任务单（TASK_TEMPLATE.md 实例）。

---

## 总体原则

1. **串行优先，确保地基稳固**——阶段 0-1 必须由 Claude Code 独占完成，后续阶段才可并行
2. **每个任务有可验证的交付物**——不是"做一部分"，而是"做完能跑"
3. **任务粒度控制在 1-3 个小时的 AI 工作量**——太大容易跑偏，太小切换成本高
4. **高风险任务给 Claude Code，低风险给 Codex**——和 OWNERS.md 一致

---

## 阶段 0：骨架搭建（必须最先完成）

| 编号 | 任务 | 负责 | 风险 | PRD 参考 | 分支名 |
|------|------|------|------|---------|--------|
| T-001 | **项目初始化**：创建目录结构（对齐 PRD §2.6 分层）、Tauri 项目初始化、Python sidecar 目录、依赖管理（requirements.txt + package.json）、基础 .gitignore | Claude Code | 中 | §2.1-2.6 | `claude/t001-project-scaffold` |
| T-002 | **Repository 接口定义**：ChapterRepository / VectorRepository / FactsRepository 抽象接口、LocalFile 实现骨架（空方法）| Claude Code | 高 | §2.6.2 | `claude/t002-repository-interfaces` |
| T-003 | **Sidecar 启动握手**：FastAPI 基础框架、stdout 端口广播、Tauri Command 监听、/health 端点、CORS 配置 | Claude Code | 中 | §2.6.7 | `claude/t003-sidecar-handshake` |

**⚠️ T-001 完成后必须更新 OWNERS.md 的目录路径为实际路径。**

**验收标准**：`tauri dev` 能启动，前端能通过 /health 确认 sidecar 在线。

---

## 阶段 1：核心状态机（Claude Code 独占，串行）

| 编号 | 任务 | 负责 | 风险 | PRD 参考 | 分支名 |
|------|------|------|------|---------|--------|
| T-004 | **数据文件读写**：settings.yaml / project.yaml / state.yaml 读写（含缺失字段补默认值）、4 位补零文件名封装 | Claude Code | 高 | §3.3-3.5, §2.6.7 | `claude/t004-data-file-io` |
| T-005 | **facts.jsonl 读写**：JSONL 逐行解析、append 写入（含 filelock）、source/revision 字段自动注入 | Claude Code | 高 | §3.6, §6.7 | `claude/t005-facts-io` |
| T-006 | **ops.jsonl 读写**：append-only 写入（含 filelock）、截断修复 + sync_unsafe 标记、op_type 枚举 | Claude Code | 高 | §2.6.5 | `claude/t006-ops-io` |
| T-007 | **章节确认流程 (ConfirmChapterService)**：草稿 → 正式章节、frontmatter 写入（全字段含 content_hash/provenance/generated_with）、state 更新、ops 追加、草稿清理 | Claude Code | 高 | §4.3 | `claude/t007-confirm-chapter` |
| T-008 | **撤销流程 (UndoChapterService)**：完整级联回滚（步骤 0-10）、≥N 草稿清理、AU 互斥锁、异步任务取消 | Claude Code | 高 | §6.3 | `claude/t008-undo-chapter` |
| T-009 | **Dirty 流程 (ResolveDirtyChapterService)**：最新章/历史章分流、facts 确认面板逻辑、无 facts 跳过面板但仍刷新 state、content_hash 重算 | Claude Code | 高 | §4.3 | `claude/t009-dirty-resolve` |
| T-010 | **Facts 生命周期**：add_fact / edit_fact / update_fact_status 完整逻辑、chapter_focus 悬空清理、resolves 级联 | Claude Code | 高 | §4.3, §6.7 | `claude/t010-facts-lifecycle` |

**验收标准**：通过集成测试——模拟 confirm → 撤销 → 重新 confirm → dirty resolve 完整流程，state/facts/ops 数据一致。

---

## 阶段 2A：上下文与生成引擎（Claude Code 主导）

| 编号 | 任务 | 负责 | 风险 | PRD 参考 | 分支名 |
|------|------|------|------|---------|--------|
| T-011 | **Tokenizer 路由**：API/local/Ollama 三模式分词、LRU Cache(maxsize=3)、fallback 到 char_mul1.5 | Claude Code | 中 | §2.4 | `claude/t011-tokenizer` |
| T-012 | **上下文组装器 (assemble_context)**：P0-P5 六层组装、budget 计算(60%)、truncation 优先级、低保预算(400 token)、reversed 注入顺序 | Claude Code | 高 | §4.1 | `claude/t012-context-assembler` |
| T-013 | **LLM Provider**：OpenAI 兼容接口调用、SSE 流式输出、错误码分类（6 种）、统一 JSON 错误响应、max_tokens 计算 | Claude Code | 中 | §2.3, §4.3 | `claude/t013-llm-provider` |
| T-014 | **生成引擎 (GenerateDraftService)**：session_llm 接收（请求体参数）、参数加载链、生成→草稿写入、generated_with 统计记录、幂等 409 | Claude Code | 高 | §4.2, §2.3.1 | `claude/t014-generate-draft` |

**验收标准**：能用 API Key 成功生成一章草稿，流式输出到终端，generated_with 完整记录。

---

## 阶段 2B：向量化与 RAG（Claude Code 主导，部分可并行）

| 编号 | 任务 | 负责 | 风险 | PRD 参考 | 分支名 |
|------|------|------|------|---------|--------|
| T-015 | **ChromaDB 初始化**：WAL 模式、collection 创建（chapters/characters/worldbuilding/oc）、embedding_lock 校验 | Claude Code | 中 | §5.1, §2.6.8 | `claude/t015-chromadb-init` |
| T-016 | **向量化切块**：frontmatter 剥离（python-frontmatter）、段落切块、chunk 元数据（chapter/branch_id）| Claude Code | 中 | §5.2 | `claude/t016-vectorize-chunking` |
| T-017 | **后台任务队列**：BackgroundTaskQueue 抽象、单工作线程串行、去重规则、cancel 支持、重试机制(指数退避)、index_status 管理 | Claude Code | 高 | §2.6.8 | `claude/t017-task-queue` |
| T-018 | **RAG 检索**：query 组装、active_chars 过滤、multi-collection 检索、top_k 降级、跨 collection 优先级（characters > oc > worldbuilding）| Claude Code | 中 | §4.1 | `claude/t018-rag-retrieval` |

---

## 阶段 2C：导入导出（可与 2B 并行）

| 编号 | 任务 | 负责 | 风险 | PRD 参考 | 分支名 |
|------|------|------|------|---------|--------|
| T-019 | **Import Pipeline**：TXT/MD 导入、虚拟章节切分、全量 characters_last_seen 扫描、last_scene_ending 提取（含 frontmatter 剥离）、facts 引导提取(5-20章) | Claude Code | 高 | §4.8 | `claude/t019-import-pipeline` |
| T-020 | **模板导出/导入**：唯一总表执行、脱敏、字段重建、剧透审查提示、完整备份 vs 模板包两个入口 | Codex | 中 | §1.7, §6.8 | `codex/t020-template-export-import` |
| T-021 | **章节导出**：txt/md/docx 格式、frontmatter 剥离、章节合并 | Codex | 低 | §6.8 | `codex/t021-chapter-export` |

---

## 阶段 3：前端 UI（Codex 主导，可与阶段 2B 并行）

| 编号 | 任务 | 负责 | 风险 | PRD 参考 | 分支名 |
|------|------|------|------|---------|--------|
| T-022 | **首页 + Fandom/AU 管理**：项目列表、新建 Fandom/AU、项目卡片 | Codex | 低 | §6.1-6.2 | `codex/t022-home-page` |
| T-023 | **写作主界面骨架**：章节流式显示区、草稿翻页、确认/丢弃/再生成按钮、撤销按钮（current_chapter>1 守卫）| Codex | 中 | §6.3 | `codex/t023-writer-ui` |
| T-024 | **本章推进焦点选择器**：unresolved facts 列表、[延续上章] 快捷键、最多选 2 个、自由发挥 | Codex | 中 | §6.3 | `codex/t024-chapter-focus-ui` |
| T-025 | **参数配置区 (6.4)**：Chatbox 风格内联模型选择器 + Temperature/Top-p 滑条 + "记住"按钮、session_llm 管理（sessionStorage）| Codex | 中 | §6.4, §2.3.1 | `codex/t025-param-config-ui` |
| T-026 | **AU 设置页 (6.5)**：模型配置、文风配置、世界观开关、core_always_include、Pinned Context、高级操作区（重算全局状态+重建索引）| Codex | 中 | §6.5 | `codex/t026-au-settings-ui` |
| T-027 | **设定库界面 (6.6)**：角色设定编辑器、aliases 管理、cast_registry 同步 | Codex | 低 | §6.6 | `codex/t027-settings-library-ui` |
| T-028 | **事实表界面 (6.7)**：facts 列表/筛选/编辑表单、别名归一化、source 自动注入、dirty 确认面板 | Codex | 中 | §6.7 | `codex/t028-facts-panel-ui` |
| T-029 | **Context 可视化面板**：P0-P5 各层 token 占用、折叠展开、降级标注(预估)、RAG 脑裂提示 | Codex | 低 | §6.3 | `codex/t029-context-viz-panel` |
| T-030 | **章节元数据信息栏**：provenance 分类展示(ai/manual/mixed/imported)、generated_with 读取、settings 逐项开关 | Codex | 低 | §6.3 | `codex/t030-chapter-metadata-bar` |

---

## 阶段 4：集成联调 + 打包

| 编号 | 任务 | 负责 | 风险 | PRD 参考 | 分支名 |
|------|------|------|------|---------|--------|
| T-031 | **前后端联调**：API 路由接入 Service 层、SSE 流式显示、错误弹窗 | Claude Code + Codex | 中 | — | `integration/t031-frontend-backend` |
| T-032 | **启动修复与对账**：validate_and_repair_project()、content_hash 对账、文件缺失/新增检测、归一化 | Claude Code | 高 | §2.6.7 | `claude/t032-startup-reconcile` |
| T-033 | **桌面打包**：PyInstaller --onedir、tiktoken BPE 预打包、ONNX 模型打包、Tauri NSIS/Wix 安装包 | Codex | 中 | §2.6.7 | `codex/t033-desktop-packaging` |
| T-034 | **E2E 验收**：首次 10 分钟路径、confirm→undo→re-confirm 全流程、dirty resolve、import 50 章 | Antigravity | 中 | §1.5 | `ag/t034-e2e-acceptance` |

---

## 依赖关系图（简化）

```
T-001 → T-002 → T-003（阶段 0，串行）
                    ↓
              T-004 → T-005 → T-006（数据 IO，串行）
                                ↓
                    T-007 → T-008 → T-009 → T-010（状态机，串行）
                                ↓                        ↓
                    T-011 → T-012 → T-013 → T-014    T-022（首页 UI）
                    （上下文+生成引擎）                  ↓
                                ↓                   T-023 → T-024 → T-025 → ...
                    T-015 → T-016 → T-017 → T-018  （前端 UI，可并行）
                    （向量化+RAG）
                                ↓
                    T-019（Import）  T-020/T-021（导出）
                                ↓
                    T-031 → T-032 → T-033 → T-034（集成+打包+验收）
```

---

## 建议的执行顺序

```
第 1 周：T-001 → T-002 → T-003（骨架，Claude Code 独占）
第 2 周：T-004 → T-005 → T-006（数据 IO，Claude Code）
第 3 周：T-007 → T-008（confirm + undo，Claude Code）
         同时 T-022 → T-023（首页 + 写作 UI 骨架，Codex）
第 4 周：T-009 → T-010（dirty + facts，Claude Code）
         同时 T-024 → T-025 → T-026（前端更多页面，Codex）
第 5 周：T-011 → T-012 → T-013 → T-014（上下文 + 生成引擎，Claude Code）
         同时 T-027 → T-028 → T-029 → T-030（设定库 + 事实表 UI，Codex）
第 6 周：T-015 → T-016 → T-017 → T-018（向量化 + RAG，Claude Code）
         同时 T-019（Import，Claude Code——需要在 RAG 之后或同周）
第 7 周：T-020 → T-021（导出，Codex）
         T-031（联调）
第 8 周：T-032 → T-033 → T-034（对账 + 打包 + E2E 验收）
```

---

## 每个任务怎么执行

```bash
# 1. 你写任务单（用 TASK_TEMPLATE.md 模板）
# 2. 开分支
git checkout main && git checkout -b claude/t001-project-scaffold

# 3. 启动 Claude Code，贴任务 prompt（含通用强制段 + 任务单）
claude

# 4. AI 做完后，你检查
git status
git diff

# 5. 对照 INTEGRATION_CHECKLIST 审核
# 6. 通过后
git add . && git commit -m "T-001: 项目骨架搭建"
git checkout main && git merge claude/t001-project-scaffold
git push
```
