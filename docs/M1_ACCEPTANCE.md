# M1 Acceptance Record

> **Historical Evidence Only(2026-08-22)**:本文件是 Legacy 里程碑验收证据,其编号不定义当前 Milestone。当前基线见 `docs/Rhiza_开发路线图_V4.1_20260824.md`(统一 M01+ 编号)。

验收日期：2026-08-14

## 结论

M1 — Chat Parity Foundation 已完成，标准门禁命令为 `npm run verify:m1`。

## 验收映射

| 验收标准 | 实现与自动化证据 |
| --- | --- |
| 连续 100 轮普通对话无消息丢失 | `server/app.test.ts` 连续提交 100 轮，校验 200 条新增消息、100 个 Manifest、ID 唯一且末轮内容正确。讨论流仅渲染最近 80 条，可分批加载更早消息。 |
| Streaming 中 Stop、刷新、重新进入页面稳定 | `e2e/provider-stream.e2e.test.ts` 使用真实 HTTP/SSE socket 验证 Stop 会中止上游且不提交半成品；完整 `RUN_END` 才原子写入，页面重新加载从持久化 workspace 恢复。 |
| Edit & Resend 创建新事件版本 | 消息保存 `versionGroupId`、`version`、`operation`、`sourceMessageId`、`replyToMessageId`；集成测试验证原消息不被覆盖，编辑和重新生成产生 v2/v3。 |
| Markdown、代码块、表格、长文本稳定显示 | `src/components/MarkdownContent.test.tsx` 覆盖 GFM 表格、代码块、引用和长文本无截断；现有测试覆盖数学公式与 Mermaid。 |
| 文件上传、附件显示和模型调用闭环 | `/api/attachments` 执行 MIME、大小和数量策略校验并持久化文件；UI 支持选择、预览和移除；集成测试验证附件文本进入 Provider 请求，附件 ID 与生成参数冻结进 Manifest。 |
| 至少 3 种 Provider/Profile 使用同一 Runtime Contract | `server/app.test.ts` 以三个独立 Provider/Profile 运行同一 `AIRuntime` 请求和事件契约；Provider SSE E2E 验证 OpenAI-compatible 网络适配器。 |
| 失败请求有明确 Retry | UI 测试验证失败提示保留输入并显示 Retry，重试请求标记为 `retry`；运行中可使用 Stop。 |
| 日常基础聊天不需要返回 LibreChat | Rhiza Discussion View 已提供 Composer、模型选择、生成参数、附件、流式输出、Stop、Retry、Regenerate、Edit & Resend、Markdown/Code、Reasoning、Tool Call 与 Usage UI。运行时仅通过适配边界复用 LibreChat 能力。 |

## M1 数据与运行时变更

- `db/migrations/0002_chat_parity.*.sql` 增加不可变消息版本、回复关系、Token Usage、Reasoning、Tool Call 和附件关系。
- Runtime Event 新增 `REASONING_DELTA`、`TOOL_CALL_DELTA`、`USAGE`，并将生成参数和附件冻结在请求与 Context Manifest 中。
- 流式结果仅在 `RUN_END` 后提交；Stop、断流和 Provider 错误不会写入不完整消息。

## 标准验证命令

```bash
npm ci
npm run verify:m1
```

`verify:m1` 覆盖 lint、TypeScript、全部单元/集成测试、E2E、许可证一致性和生产构建。提供 `DATABASE_URL` 时还会运行外部 PostgreSQL 真库迁移；CI 使用 PostgreSQL 17 执行该用例。
