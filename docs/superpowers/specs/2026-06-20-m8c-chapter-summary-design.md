# M8-C · Chapter Summary 层设计（A2：RAG 嵌入）

- Date: 2026-06-20
- Status: Implemented（2026-06-20 实现完成，引擎 778 + UI 164 全绿，tsc 双端干净；codex 计划审 2 BLOCKER+5 MAJOR 已折叠修复；待 codex 实现审 triage + 用户复核 + 真机出章）
- Source: D-0041 Memory 架构重设计（§5 Summary 三层生成）
- Owner: Human PM + CC
- Decisions baked in（用户 2026-06-20 确认）: ① 只做 standard 一档 ② 生成挂 confirm 后、失败不回滚 ③ 检索排除当前章自身摘要 ④ 复用既有 `disableChapterSummary` flag

---

## 一、背景与问题

D-0041 §1 识别的根本问题之一：**事实碎片化无法承载叙事记忆**。当前 Facts 系统每章 3-5 条原子事实，跨 30+ 章后无法重建章节阅读体验；用户体感"跟通用 chat 差别不大"。

Chapter Summary 层用每章一条连贯叙事摘要补这个盲区：给 LLM 的不再是割裂的事实散点 + 割裂的章节 chunk，而是**连贯的整章记忆**（+ 压缩，同预算塞下更多章）。

现状（已确认）：章节 chunk RAG 已存在（`split_chapter_into_chunks` → vector store `chapters` collection → P4 注入，`CHAPTERS_TOP_K=8` 带时间衰减）。摘要是在此之上**增加**一个新 collection，不是从零造检索。

## 二、范围

**在内（M8-C 本轮）：**
- 每章生成 `standard` 摘要（180-250 字叙事，情感保真）
- 存 `chapters/main/ch{NNNN}.summary.jsonl`，带 `source_chapter_hash`
- 嵌入向量库新 collection `summaries`，在 P4 检索注入
- 章节编辑后重生成 + 重嵌入
- 门控复用 `getSimpleFeatures(mode).disableChapterSummary`

**不在内（推后）：**
- `micro` / `detailed` 两档 → 待其消费者（章节列表 UI / M10 回看）落地再补（文件 schema 留位，补档零迁移）
- Retrospective rewrite（每 5 章重写）→ **M10**
- 冷热分层 / archived 注入策略 → **M10**
- Layer 2/3 Fact 字段的 ReAct 提取 → **M9 / D-0042**

## 三、已确认决策（详注）

| # | 决策 | 理由 | 影响面 |
|---|------|------|--------|
| ① | 只生成 `standard` 一档 | 只有 standard 现在有消费者（注入）；micro/detailed 的使用方未建，先生成=死数据 | 生成服务 + 文件 schema（留位 micro/detailed 键） |
| ② | 生成挂 confirm 落盘**之后**，失败只 log 降级不回滚章节 | 正文是核心资产，摘要是辅助；辅助失败绝不能威胁正文 | confirm 接缝 `engine-chapters.ts:119` 同级 |
| ③ | 检索时排除"当前/最近章"自身摘要 | 该章全文已在 P2，避免同章既全文又摘要、浪费预算 | `retrieve_rag` 过滤 |
| ④ | 复用既有 `disableChapterSummary` flag | 该 flag 已声明但无消费者，本就为此预留；不造平行开关 | 生成入口读 `getSimpleFeatures(mode)` |

## 四、架构与集成点

| 关注点 | 落点（现状 file:line） | 改动 |
|--------|----------------------|------|
| Fact 不变 | `domain/fact.ts` | 不动（本轮不碰 Fact 字段） |
| RAG collection 真相源 | `domain/context_summary.ts:7` `RAG_COLLECTIONS` | 加 `"summaries"` + `RagCollection` 类型派生 |
| 章节索引接缝 | `src-ui/src/api/engine-chapters.ts:119` `ragManager.indexChapter(...)` | 其后追加：生成摘要 + `indexChapterSummary` |
| 全量重建 | `services/rag_manager.ts:56` `rebuildForAu` / `engine-state.ts:72` | 重建时一并重建 summaries |
| 检索 | `services/rag_retrieval.ts:145` `retrieve_rag` | 加 summaries 检索 + 衰减 + 排除当前章 + 格式化分组 |
| 章节内容 hash | `services/confirm_chapter.ts:116` `compute_content_hash` | 复用作 `source_chapter_hash` |
| 编辑接缝 | `services/chapter_edit.ts` | 编辑后重生成 + 重嵌入 |
| 简版门控 | `config/simple_features.ts:25` `disableChapterSummary` | 由声明变为生效 |

## 五、数据模型

新 domain 类型 + repository（接口 + file 实现，复用 `PlatformAdapter`）。

存储 `chapters/main/ch{NNNN}.summary.jsonl`（D-0041 §5 路径）：

```yaml
standard:
  version: 1
  text: "180-250 字叙事摘要（情感保真）"
  generated_at: <ISO8601>
  source_chapter_hash: <章节 content_hash>
# micro / detailed 键预留，本轮不生成、不读
```

- `ChapterSummary` 类型字段含 tier keyed 结构；`createChapterSummary` 默认值单一真相源。
- Repository：`getSummary(auPath, chapterNum)` / `saveSummary(auPath, chapterNum, summary)` / `deleteSummary`。

## 六、生成

- **触发**：confirm 落盘后、章节 chunk 索引旁（`engine-chapters.ts:119` 同级），best-effort。
- **门控**：`getSimpleFeatures(mode).disableChapterSummary === false` 且 embedding 可用（full 模式 `disableRAG=false`）才生成+嵌入。
- **调用**：1 次 LLM call，新 prompt key `SUMMARY_STANDARD_SYSTEM` / `SUMMARY_STANDARD_USER`（zh + en）。
- **情感保真 = prompt 指令**："保留情绪节拍/张力，不要像事实提取那样过滤情感"（对比 `facts_extraction` 明确滤情感）。这是 D-0041 §7 Q5 对 Summary 的答案，不引入 schema 字段。
- **失败处理**：生成/嵌入抛错 → 经 logger 记录后吞掉，章节不受影响（决策②）。`source_chapter_hash` 写入失败同理。

## 七、索引与检索

**索引**（`rag_manager.ts`）：
- 新方法 `indexChapterSummary(auPath, chapterNum, summaryText, embeddingProvider)`：摘要文本作 1 个 vector，id `sum{chapterNum}`，`collection: "summaries"`，metadata `{au_id, chapter, kind: "standard"}`。
- `rebuildForAu` 遍历章节时，若该章有 `.summary.jsonl` 则一并 `indexChapterSummary`。

**检索**（`rag_retrieval.ts`）：
- 新增 `summaries` collection 检索，`SUMMARIES_TOP_K`（建议 4），带时间衰减（同 chapters）。
- **排除当前章**（决策③）：过滤掉 `metadata.chapter === current_chapter` 的摘要（其全文已在 P2）。
- `formatRagChunks` 加 `summaries` 分组 + 新 prompt label `RAG_LABEL_SUMMARIES`（zh + en）。
- `RAG_COLLECTIONS`、`toRagChunkDetail` 守卫、超预算优先级链同步纳入 `summaries`。

## 八、陈旧与生命周期

- 章节编辑（`chapter_edit.ts`）→ content_hash 变 → 同接缝重生成摘要 + 重嵌入（覆盖 id `sum{N}`）。
- `source_chapter_hash` 兜底：重建/检索时若发现 hash 与当前章节 content_hash 不符 → log warn 标记陈旧。**真正的惰性自动重生成留 M10** 与冷热分层一起做（本轮只 warn，不自动重跑，避免在检索热路径塞 LLM 调用）。

## 九、错误处理 / 降级

- 生成失败、无 embedding provider、摘要文件缺失、嵌入失败 → 一律静默降级（章节正常、RAG 少几条），沿用现有 RAG 容错风格（`searchCollection` 的 try/catch + fallback）。
- 不新增任何会阻断主写作流程的硬失败路径。

## 十、测试计划

每块 TDD（先测后码），引擎 `vitest run` 必须全绿，不破坏既有 full 模式行为。

1. **domain + repo round-trip**：写 `.summary.jsonl` → 读回，字段 + hash 一致。
2. **prompt keys**：`SUMMARY_STANDARD_*` + `RAG_LABEL_SUMMARIES` zh/en 齐备（既有 i18n 覆盖 lint 复用）。
3. **生成服务**：mock LLM → `.summary.jsonl` 形状 + `source_chapter_hash` 正确；简版 `disableChapterSummary` 不生成；生成失败不抛、章节不受影响。
4. **索引**：`indexChapterSummary` → vector store `summaries` collection 有条目；`rebuildForAu` 含 summaries。
5. **检索**：`retrieve_rag` 出 summaries 且按 `RAG_LABEL_SUMMARIES` 分组；**当前章摘要被排除**；超预算时 summaries 进优先级链。
6. **陈旧**：编辑章节 → content_hash 变 → 重生成覆盖；hash 不符时 warn。
7. **golden/budget 预期 delta**：full 模式上下文 P4 多 summaries 分组 + 新 prompt keys → 属"预期内非零回归"，更新基线（同 Phase 1 先例），非破坏。

## 十一、推后的开放问题（M9/M10 再定）

- D-0041 §7 Q3 retrospective 触发时机 → M10
- D-0041 §6 冷热分层注入策略 → M10
- Layer 2/3 字段 + ReAct 提取（含 Q1/Q4/Q5 的 Fact 侧）→ M9
- micro/detailed 两档的消费者 UI → 各自 feature

---

## 附：权威来源

D-0041 全文不在主仓（`docs/internal/` gitignore，原件在 `nbssdlkm` Tailscale 主机 `D:\fanfic-system\docs\internal\decisions\D-0041-memory-architecture-redesign.md`）。本 spec §五-§八 的 schema/路径/三档定义忠实复刻 D-0041 §5，仅按已确认决策裁剪范围（只做 standard）。
