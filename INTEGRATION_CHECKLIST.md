# 集成前检查清单（INTEGRATION CHECKLIST）

> 所有任务在请求合并前，必须逐项自检。

---

## A. 边界检查

- [ ] 有任务单，并且任务单完整
- [ ] 实际修改文件未超出允许范围，或已明确说明例外
- [ ] 未发生“顺手修核心逻辑”
- [ ] 未与其他进行中的任务形成同模块冲突

---

## B. 核心风险检查

- [ ] 未修改核心状态机；或若已修改，已由核心 owner 主导
- [ ] 若改动 confirm / undo / import / dirty / facts lifecycle，已明确标为高风险
- [ ] 若改动 state schema / repository interface，已同步检查相关依赖
- [ ] 若改动平台能力相关逻辑，未违反 `DECISIONS.md`

---

## C. 一致性检查

- [ ] 改动未与 PRD / `DECISIONS.md` 冲突
- [ ] 若引入新规则，已更新 `DECISIONS.md`
- [ ] 若改动影响文档，已同步更新 docs / PRD 引用
- [ ] 若改动影响 UI 文案或行为，已检查是否与产品规则一致

---

## D. 测试检查

- [ ] 相关单元测试已通过
- [ ] 相关集成测试已通过
- [ ] 必要的 E2E / 手动流程已验证
- [ ] 未引入新的 lint / type 错误

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
- [ ] ops.jsonl 的 append-only 规则未被破坏

---

## F. PRD 对齐专项检查

若任务涉及新增字段、新增枚举值、或修改写入路径，必须逐项确认：

- [ ] 新增字段已覆盖所有写入路径（confirm / import / undo / dirty resolve）——对照 PRD 写路径契约表
- [ ] 新增枚举值已更新所有消费方（字段表 / 示例行 / UI 展示 / 导出剥离列表 / checklist）
- [ ] 新增 frontmatter 字段已加入导出剥离列表
- [ ] 新增 frontmatter 字段已分类（权威字段 vs 统计快照）
- [ ] 新增 op_type 已加入 op_type 清单 + 写路径契约表
- [ ] 新增 settings 字段已按默认归属规则分类（不确定→默认 local）
- [ ] 改动未与 PRD 的 Phase 1 功能冻结声明冲突

---

## G. 合并结论

- [ ] 建议合并到 `integration`
- [ ] 需要额外复核后再合并
- [ ] 不建议合并，需重开任务

