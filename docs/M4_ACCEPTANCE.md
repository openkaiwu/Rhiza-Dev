# M4 Acceptance — Explicit Context + Immutable Manifest

> **Historical Evidence Only(2026-08-22)**:本文件是 Legacy 里程碑验收证据,其编号不定义当前 Milestone。当前基线见 `docs/Rhiza_开发路线图_V4.2_20260829.md`(统一 M01+ 编号)。

## 结论

M4 已完成。每次正式模型调用都会冻结唯一 Context Manifest；用户可以在 Context Inspector 中查看 Active / Recommended / Excluded 清单，将 Node 或 Segment 加入上下文，并对条目执行 Pin、移除、排除和恢复。历史 AI 回答可展开查看当时的来源快照、加入原因、选择方式、内容版本、token 估算、模型和 request ID。

## 验收映射

- [x] 每一次模型调用都可追溯到唯一 Manifest：`requestId` 唯一，AI 消息保存 `manifestId`，流式执行只在完成后原子提交。
- [x] 用户能够看到 Active Context 清单：Inspector 明确展示本轮生效、可加入和已排除分组。
- [x] 用户可 Pin / Remove / Exclude Node 或 Segment：支持来源添加和完整状态操作，状态持久化到 JSON / PostgreSQL workspace。
- [x] Context Inspector 能显示来源和加入原因：显示 Node / Segment / Reference 类型、来源标题、选择方式、reason 和 token 估算。
- [x] Regenerate 默认创建新的 Manifest：重新生成沿用原问题，但重新冻结当前上下文并生成新 ID；历史 Manifest 不被覆盖。
- [x] 历史回答能显示对应 Manifest 摘要：回答卡片可展开 frozen source snapshot。
- [x] Context 超预算时不会静默丢弃显式 Pin 内容：M4 不执行自动裁剪；超出 32K 时显示警告，Pin 项仍进入 Runtime request 和 Manifest。
- [x] 同一 Prompt 使用不同 Context 时，用户能够从 UI 理解差异来源：每个回答独立显示它自己的冻结来源、排除数量、模式、模型和 token 估算。

## 自动化证据

- API 单元测试验证 Node / Segment 来源、Pin / Remove / Exclude / Restore。
- API 单元测试验证 40K token Pin 来源不会被丢弃。
- API 单元测试验证 Regenerate 创建新 Manifest，且旧 Manifest 内容保持不变。
- UI 单元测试验证 Pin 操作和历史 Manifest 展开摘要。
- 既有 100 轮会话测试验证 100 个 Manifest 和消息完整保留。
- PostgreSQL migration / schema / store E2E 验证关系型持久化。

## 执行命令

```bash
npm run verify:m4
```

该命令继承 M0–M3 的 lint、typecheck、unit、E2E、license 和 production build 门禁。
