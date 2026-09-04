# ADR-004: Transactional State、Domain Journal 与 Command Receipt

- Status: Accepted
- Date: 2026-08-23
- Baseline: Rhiza Architecture & Roadmap Baseline V4.0, M01
- Carried forward: V4.2; implementation accepted through M05 evidence
- Supersedes: none
- Superseded by: none

## Context

作出本决策时，持久化是全量快照差量 upsert，`AuditEvent` 不是语义历史，且没有 Command Receipt。V4.0 I-03/I-04、§6 要求 Current State 与 append-only Domain Journal 同时存在，同时明确不采用全量 Event Sourcing 或跨外部系统的分布式事务。M05 已通过 `WorkspaceUnitOfWork`、`workspace_events` 与 `command_receipts` 落地该事务边界。

## Decision

M05 中每个成功 Application Command 必须在一个本地数据库事务内完成：取得 `(workspace_id, command_id)` 的事务级锁、校验 scope/revision、写 Transactional State、预留该 workspace 的 event sequence、append 1..N Domain Event、写 Command Receipt、commit。任何一步失败则回滚全部；相同 command id 重试返回已有 committed/rejected 的稳定结果而不重复事件。

Domain Journal append-only，只记录低频业务事实。Execution Trace 与 Transient Stream 分开存放；token/stdout/file-read 等高频细节不能写入 `workspace_events`。外部 Provider/Agent/CLI 调用在本地事务之间，以 ExecutionRun 表达，绝不纳入本地数据库事务。

## Alternatives considered

- 仅保留 mutable current state：不能重放或审计事实，拒绝。
- 全量 Event Sourcing/CQRS 平台：超出 V4.0 目标和当前复杂度，拒绝。
- State、events、receipt 分三次提交：会产生幽灵状态、重复事件或不可重试命令，拒绝。
- 将 trace/chunk 写入 Journal：会放大争用和 retention 成本，违反 I-04，拒绝。

## Consequences

StorePort 必须暴露真实事务、唯一约束和 crash recovery；Journal 可用于重建声明为 Projection 的数据，snapshot 只用于加速。数据库权限限制 Application role 对 Journal 为 SELECT/INSERT，审计日志仍独立于 Journal。每个 Command 都会需要稳定 command id、receipt 状态和明确错误 taxonomy。

## Migration and rollback

M05 以 expand/contract 创建 event head、workspace events、receipts 和 transaction-capable embedded/PostgreSQL adapters，先双写并验证 replay/checksum，再让 Application 以新路径为唯一写入口。事故时停止切换、从 transaction evidence 重建 state 或使用旧 snapshot 的受限只读恢复；不得删除 Journal。旧 mutable/deleteMissing 路径仅在 M10 完成迁移验证后移除。

## Supersession

event envelope/catalog、sequence allocation 或 receipt semantics 的破坏性变更必须以 ADR supersede（ADR-005 细化 catalog）；trace retention 的独立策略不 supersede 本事务模型。
