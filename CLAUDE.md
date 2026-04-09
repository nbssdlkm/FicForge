# FicForge · 粮坊 — Claude Code 项目指南

## 项目概况

FicForge 是面向同人写手的 AI 辅助续写工具。当前正在进行 **架构迁移**：从 Python 后端 + Tauri 桌面端迁移到 TypeScript 统一核心引擎，以同时支持桌面端（Tauri）和移动端（Capacitor/PWA）。

## 架构（PRD v4, D-0034）

```
TypeScript 核心引擎 (src-engine/)
  ├── domain/          数据类型、枚举、工具定义（来自 core/domain/*.py）
  ├── prompts/         55 个中英文模板（来自 core/prompts/*.py）
  ├── services/        全部业务逻辑（来自 core/services/*.py）
  ├── repositories/    抽象接口（9 个 TypeScript interface）
  ├── llm/             LLM 调用（openai-node SDK）
  ├── tokenizer/       Token 计数（js-tiktoken）
  ├── vector/          内存向量检索（JSON 分片 + cosine similarity）
  └── sync/            多设备同步引擎（ops 合并 + state/facts 重建）

Platform Adapter
  ├── TauriAdapter     桌面端文件 I/O
  ├── CapacitorAdapter 移动端文件 I/O
  └── WebAdapter       PWA（OPFS/WebDAV）

壳层
  ├── Tauri 壳 + 可选 Python sidecar（仅本地 embedding）
  └── Capacitor 壳 (Android) / PWA (iOS/Web)
```

## 迁移阶段（当前进度）

| Phase | 内容 | 状态 |
|-------|------|------|
| M0 | Domain 模型、Prompt 模板、Token 计数、PlatformAdapter 接口 | **已完成** |
| M1 | Repository 接口+实现、向量存储（JSON 分片）、ChromaDB 迁移脚本 | **已完成** |
| M2 | Facts Lifecycle、Context Assembler、RAG、LLM Provider、Generation | **已完成** |
| M3 | Confirm/Undo Chapter、Dirty Resolve、Import/Export | **已完成** |
| M4 | Settings Chat、Trash、Recalc、前端 API 切换、SSE 消除、Sidecar 精简 | **已完成**（E.6 Sidecar 精简待人工执行） |
| M5 | 移动端 Capacitor/PWA、响应式 UI、ops 合并引擎、数据同步 | 待开始 |
| M6 | Agent 架构（开关矩阵、Checker、导演细纲、任务模式、报警暂停） | 待开始 |

## 关键决策

- **D-0034** 架构迁移为 TypeScript 统一核心引擎
- **D-0035** 向量存储从 ChromaDB 迁移为 JSON 分片 + 内存检索
- **D-0036** 数据同步基于 ops 日志合并（ops 是唯一 truth，state/facts 是 ops 的投影）
- **D-0037** 移动端 Capacitor (Android) + PWA (iOS/Web)
- **D-0038** 桌面端和移动端各自独立管理 Embedding 模型

## 技术栈

| 层 | 技术 |
|----|------|
| 核心引擎 | TypeScript（src-engine/，独立于 UI） |
| 前端 | React + Vite（src-ui/） |
| 桌面壳 | Tauri 2 |
| 移动壳 | Capacitor (Android) / PWA (iOS) |
| LLM 调用 | openai-node SDK（OpenAI 兼容接口） |
| Token 计数 | js-tiktoken |
| 向量检索 | JSON 分片 + 内存 cosine similarity |
| YAML 读写 | js-yaml |
| Frontmatter | gray-matter |
| Docx 导入 | mammoth.js |
| 本地 Embedding | Python sidecar（可选，bge-small-zh） |

## Python 后端（src-python/，迁移中）

迁移完成前仍然保留运行。迁移后精简为 ~150 行仅做本地 embedding：
- `POST /embed` 接受文本返回向量
- `GET /health` 心跳检测

## 内部参考文档

`docs/internal/` 目录（.gitignore 排除，不进公开仓库）：
- `prd/` — PRD v2 + 补充 PRD v2/v3/v4
- `audit/` — CC 审计报告
- `decisions/` — 决策记录
- `devlog/` — 开发日志
- `milestone/` — 里程碑总结
- `governance/` — 治理文档

## 高风险模块（迁移时重点关注）

1. **undo_chapter**（10 步级联回滚，无 unit 测试）→ 迁移前先补 Python 端测试建立 golden test
2. **context_assembler**（P0-P5 六层预算竞争）→ 固定输入/输出 golden test
3. **ops.jsonl 多设备同步** → lamport clock + op_id 去重 + state/facts 从 ops 重建

---

## Claude Code 行为约束

### 禁止自行操作
- **禁止** 自行执行 git push
- **禁止** 自行执行 git merge
- **禁止** 自行切换到 main 分支
- **禁止** 自行创建 PR 并合并

### 必须等待人工确认
- 完成任务后，输出结论和 git diff --stat，等待人工确认
- 人工说"提交"或"合并"后才可执行 git 操作
- 如果人工没有明确指示，就停在当前状态等待

### 允许的 git 操作
- git add（暂存改动）
- git commit（在当前分支提交）
- git status / git diff / git log（查看状态）

### 分支规则
- 在人工指定的分支上工作，不自行创建或切换分支

---

## 架构迁移

> 迁移总览、架构图、关键决策（D-0034 ~ D-0038）见上文对应章节，此处不重复。

### 参考文档位置（必读 / 参考）

```
docs/internal/prd/FicForge-补充PRD-v4-架构迁移与移动端-final.md  — 迁移方案（必读）
docs/internal/audit/CC-AUDIT-migration.md                       — 源码审计报告（必读）
docs/internal/prd/fanfic-system-PRD-v2.md                        — 原始功能设计（参考）
docs/internal/decisions/DECISIONS-updated.md                     — 所有架构决策（参考）
```

### 迁移原则

1. **Python 源码是最权威的规格说明书**。PRD 定义"应该怎样"，Python 代码定义"实际怎样"。两者冲突时以代码为准
2. Repository 接口签名直接复制到 TypeScript interface
3. 不要改动现有 Python 代码（除非是补测试）
4. 每个 Phase 完成后写 devlog 到 `docs/internal/devlog/`

### src-engine/ 目录补充

上文架构图列出了核心子目录。以下是架构图未体现的补充细节：

- `repositories/interfaces/` — TypeScript interface（从 Python ABC 翻译）
- `repositories/implementations/` — 文件 I/O 实现
- `platform/` — PlatformAdapter 接口 + 平台适配（Tauri / Capacitor / Web）
- `index.ts` — 统一导出入口

前端导入方式：`import { ... } from "@ficforge/engine"`（Vite alias 已配置）。

### 文件所有权

| 范围 | 负责人 |
|------|--------|
| `src-engine/` 全部 | CC |
| 前端 API 层切换（client.ts 等） | CC |
| 移动端 UI 适配 | Codex（后续任务） |
| 现有 Python 代码 | 冻结，不改动 |
