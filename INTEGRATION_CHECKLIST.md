# 合并前检查清单（INTEGRATION CHECKLIST）

> 任务在请求提交 / 合并前，逐项自检。
> **2026-07 修订**：原清单诞生于多任务并行 + `integration` 分支 + PRD 在库时代；现按现行工作流（单 `main` / worktree 任务分支 + 人工确认提交合并，见 CLAUDE.md「Claude Code 行为约束」）重写。E/F 两节的专项检查项沿用原文，仍然有效。

---

## A. 边界检查

- [ ] 实际修改文件未超出任务范围，或已明确说明例外
- [ ] 未发生"顺手修核心逻辑"（发现顺手项 → 单独列出等拍板，不混入本次改动）
- [ ] 未与其他进行中的会话 / 分支形成同模块冲突

---

## B. 核心风险检查

- [ ] 若改动 confirm / undo / import / dirty / facts lifecycle / 记忆栈写路径，已标为高风险并重点自检
- [ ] 若改动 state schema / repository 接口 / domain 类型，已同步检查全部实现与消费方
- [ ] 改动未违反 `DECISIONS.md`（D-0001~0031）与 CLAUDE.md「关键决策」

---

## C. 一致性检查

- [ ] 若引入新规则 / 新契约，已更新 `DECISIONS.md` 或在 CLAUDE.md「关键决策」补摘要
- [ ] 若改动影响文档，已同步更新 docs/（含 `docs/README.md` 索引）
- [ ] 用户可见文案全部走 i18n，中英文 key 对称，不硬编码

---

## D. 测试与验证

- [ ] 引擎 + UI 测试全绿；双包 tsc 0 错
- [ ] i18n key 对称检查通过
- [ ] 新增 / 修改行为有判别性测试（round-trip 闭环、失败路径优先于快乐路径）
- [ ] 非平凡改动已过独立对抗审；可在浏览器观察的 UI 改动已 preview 眼验
- [ ] `PROGRESS.md` 已按会话收尾约定更新

---

## E. 状态流专项检查（高优先级）

若任务涉及下列内容，必须专项确认：

- [ ] `current_chapter` 语义未漂移
- [ ] confirm chapter 行为未被意外改变
- [ ] undo latest chapter 级联仍正确（含 ≥N 草稿清理）
- [ ] dirty 章节处理链未断（含最新章/历史章分流）
- [ ] `last_scene_ending` 更新/回滚逻辑未断
- [ ] facts lifecycle 与 rollback 例外规则未断
- [ ] `chapter_focus` 悬空清理逻辑未断
- [ ] ops.jsonl 的 append-only 规则未被破坏（audit log 契约，D-0040）

---

## F. 数据链专项检查（新增字段 / 枚举 / 写入路径）

若任务涉及新增字段、新增枚举值、或修改写入路径，必须逐项确认（方法论见 CLAUDE.md「查 Bug 的方法论」）：

- [ ] 新增字段已覆盖所有写入路径（confirm / import / undo / dirty resolve），且读取路径对称（有写必有读，round-trip 测试证明闭环）
- [ ] 新增字段已接 dict-to-domain 映射函数、序列化函数与所有 copy/clone 点（TypeScript 静态类型不检查 yaml 字典转换）
- [ ] 新增枚举值已更新所有消费方（映射函数 / UI 展示 / 导出剥离列表 / 本清单）
- [ ] 新增 frontmatter 字段已加入导出剥离列表，并已分类（权威字段 vs 统计快照）
- [ ] 新增 settings 字段已有 create 默认值（引擎单一真相源）+ round-trip 测试

---

## G. 结论

- [ ] 可请求人工确认提交 / 合并
- [ ] 需要额外复核后再请求
- [ ] 不建议合并，需重开任务
