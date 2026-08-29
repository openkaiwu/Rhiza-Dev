# ADR-005: Domain Event Catalog、Sequence 与 Backfill 语义

- Status: Accepted
- Date: 2026-08-30
- Baseline: Rhiza Architecture & Roadmap Baseline V4.2, M05
- Supersedes: none
- Superseded by: none

## Context

ADR-004 已冻结 State + Event + CommandReceipt 同事务，但尚未定义哪些记录属于低频业务事实、事件如何排序，以及历史 Workspace 如何建立可重放起点。若直接把 Runtime chunk、token、stdout 或 file-read 写入 Journal，会把瞬态遥测误当成领域事实，并放大每个 Workspace 的事务争用。

## Decision

`workspace_events` 只保存已提交的低频语义事实。每个 Event Envelope 包含稳定 `event_id`、`workspace_id`、严格递增的 workspace-local `sequence`、`event_type`、`schema_version`、aggregate identity、ActorRef、ScopeRef、`command_id`、可选 correlation id、payload、occurred/recorded time。

M05 v1 catalog 为：

- `workspace.baseline.backfilled`；
- `conversation.run.committed`；
- `context.mode.changed`、`context.selection.changed`、`context.source.added`；
- `graph.node.created`、`graph.node.activated`、`graph.node.status_changed`、`graph.layout.updated`；
- `graph.relation.created`、`graph.relation.removed`；
- `segment.created`、`branch.created`、`message.merge_revision.created`；
- `resource.registered`、`resource.version.created`；
- `object.archived`、`object.purged`。

Catalog 只允许 additive event type 或 additive optional payload field。破坏性 payload 变更必须发布新的 `schema_version`，旧版本仍可读取与重放。M05 不定义任何 `workflow.*` event。

`workspace_event_heads.last_sequence` 是唯一 sequence allocator。成功命令在同一事务内锁定 `(workspace_id, command_id)`、校验 receipt、写 state、预留连续 sequence、append event、写 committed receipt。相同 command id 重试返回既有 receipt 结果，不运行 mutation、不新增事件。确定性的 4xx 拒绝可在失败事务回滚后写 rejected receipt；基础设施失败不缓存为拒绝。

历史数据只产生一个 `workspace.baseline.backfilled` 事实，payload 保存当前声明式状态的 semantic checksum 和对象计数。不得伪造历史上没有实际发生过的细粒度事件。backfill command id 固定为 `backfill:workspace-baseline:v1`，因此可中断、可重跑。

Execution Trace 与 Transient Stream 不属于 Domain Journal。token、stream chunk、stdout/stderr、file-read、心跳和采样 telemetry 必须进入各自的短期存储或观测通道。

## Consequences

Workspace activity timeline 可直接查询 Journal，不读取 AuditEvent 或推断 mutable snapshot。Projection 可从 baseline + tail 重建；snapshot 仍是加速手段。Application 调用方只学习一个 UoW interface，不需要理解 sequence、receipt 或事务步骤。

## Migration and rollback

0007 migration 只 expand：新增 heads、events、receipts、索引和 Journal UPDATE/DELETE trigger。回滚部署时保留表与事实，旧代码可继续读取 current state；不得以应用回滚为由删除 Journal。M10 contract 阶段之前保留 legacy importer 与 shadow reconciliation。
