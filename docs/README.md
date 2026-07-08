# docs/ 索引

> 2026-07-08 整理。找文档先看这里；已废弃的文档带 ⚠️ 头、仅作历史参考。

## 现行文档（可信）

| 文档 | 内容 | 状态 |
|---|---|---|
| [TECH-DEBT.md](TECH-DEBT.md) | 技术债清单（**引用任何 TD-0xx 前必查其「状态」行**；当前唯一 open：TD-017） | 现行 |
| [BUILD.md](BUILD.md) | 三端打包指南（Tauri / Capacitor Android / PWA，含内置 SW 说明） | 现行 |
| [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) | 视觉设计 token、UI 原语与贡献约定 | 现行 |
| [D-0033-i18n-known-limitations.md](D-0033-i18n-known-limitations.md) | i18n 已知限制决策记录（dated，仍有效） | 现行 |
| [superpowers/specs/](superpowers/specs/) | 功能设计 spec（M8-M10、融合主线、backfill 等 9 份；**新 spec 的归处**） | 现行 |
| [superpowers/plans/](superpowers/plans/) | 对应实施计划 | 现行 |

## 内部文档（`docs/internal/` 默认被 .gitignore，下列文件为 force-add 入库）

| 文档 | 内容 |
|---|---|
| [internal/audit/2026-07-07-round2-full-review.md](internal/audit/2026-07-07-round2-full-review.md) | 第二轮全量审计报告：62 发现 + 设计符合性核对 + 发现→修复 commit 映射 + 四轮对抗审处置（**查历史缺陷与修复依据的首选入口**） |
| [internal/plans/2026-07-07-model-picker-decision.md](internal/plans/2026-07-07-model-picker-decision.md) | 模型选择器方案 B 决策记录（已拍板并落地） |
| [internal/plans/2026-07-07-model-landscape-research.md](internal/plans/2026-07-07-model-landscape-research.md) | 2026-07 各服务商模型行情调研（MODEL_CONTEXT_MAP 数据来源） |
| [internal/plans/2026-07-07-kelivo-model-picker-notes.md](internal/plans/2026-07-07-kelivo-model-picker-notes.md) | Kelivo/Cherry Studio 选择器拆解与实施蓝图 |
| internal/plans/system-optimization-*.md | 2026-04 代码质量硬化计划（头部有 2026-06 核对结论：绝大部分已被后续工作落地） |

## 已废弃（仅历史参考）

| 文档 | 废弃原因 |
|---|---|
| [API-REFERENCE.md](API-REFERENCE.md) | Python HTTP 后端时代的端点表；**现行 API 真相源 = `src-ui/src/api/engine-client.ts`**（前端直调 TS 引擎，无 HTTP 层） |
| [SYNC-GUIDE.md](SYNC-GUIDE.md) / [SYNC-GUIDE_zh.md](SYNC-GUIDE_zh.md) | 应用内 WebDAV 同步已退役（D-0040 / M7）；文件夹级云盘镜像作为手动实践仍可用 |

## 不在仓库内的资料

PRD（v2/v4/v5）、D-00xx 决策记录原文、devlog：Obsidian `D:\MY LIFE\FicForge\` 或归档处（见 CLAUDE.md「内部参考文档」节）。
