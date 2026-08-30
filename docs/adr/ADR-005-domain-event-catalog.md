# ADR-005: Domain Event Catalog、Sequence 与 Backfill 语义

- Status: Accepted
- Date: 2026-08-30
- Baseline: Rhiza Architecture & Roadmap Baseline V4.2, M05
- Supersedes: none
- Superseded by: none

## Context

ADR-004 已冻结 State + Event + CommandReceipt 同事务，但尚未定义哪些记录属于低频业务事实、事件如何排序，以及历史 Workspace 如何建立可重放起点。若直接把 Runtime chunk、token、stdout 或 file-read 写入 Journal，会把瞬态遥测误当成领域事实，并放大每个 Workspace 的事务争用。

## Decision

`workspace_events` 只保存已提交的低频语义事实。每个 Event Envelope 保留 V4.1 CloudEvents 1.0 合约：稳定 `event_id`、`workspace_id`、严格递增的 workspace-local `sequence`、`ce_specversion`、`rhiza_envelope_version`、`event_type`、source/subject/data schema、aggregate identity/revision、ActorRef、ScopeRef、`command_id`、`event_index`、可选 causation/correlation id、payload、occurred/recorded time。`(workspace_id, command_id, event_index)` 唯一。

M05 v1 catalog 为：

- `workspace.baseline.backfilled`；
- `workspace.created`、`workspace.renamed`、`workspace.archived`、`workspace.restored`；
- `conversation.run.committed`；
- `context.mode.changed`、`context.selection.changed`、`context.source.added`；
- `graph.node.created`、`graph.node.activated`、`graph.node.status_changed`、`graph.layout.updated`；
- `graph.relation.created`、`graph.relation.removed`；
- `segment.created`、`branch.created`、`message.merge_revision.created`；
- `resource.registered`、`resource.version.created`；
- `object.archived`、`object.purged`。

Catalog 只允许 additive event type 或 additive optional payload field。破坏性 payload 变更必须发布新的 major `data_schema`，旧版本仍可读取与重放。M05 不定义任何 `workflow.*` event。

`workspace_event_heads.last_sequence` 是唯一 sequence allocator。成功命令在同一事务内锁定 `(workspace_id, command_id)`，按统一顺序取得 Workspace 写锁、校验 receipt/revision、写 state、预留连续 sequence、append event、写 committed receipt。相同 command id 重试返回既有 receipt 结果，不运行 mutation、不新增事件。确定性 4xx 拒绝回滚到 savepoint 后，在仍持有命令锁的同一事务写 rejected receipt，避免并发重试抢入；基础设施失败回滚整个事务，不缓存为拒绝。HTTP `Idempotency-Key` 映射到稳定 command id，同一 id 不得换用 command type。

历史数据只产生一个 `workspace.baseline.backfilled` 事实，payload 内联保存 `rhiza.workspace-semantic.v1` baseline snapshot、`sourceSequence=0`、semantic checksum 和对象计数。新建 Workspace 的 `workspace.created` 自带起点 snapshot。普通命令的最后一个 event 保存变化的语义 section，baseline + tail 可校验到当前 state checksum；Current State 仍是读写权威，不引入全量 Event Sourcing。不得伪造历史上没有实际发生过的细粒度事件。backfill command id 固定为 `backfill:workspace-baseline:v1`，因此可中断、可重跑。

Execution Trace 与 Transient Stream 不属于 Domain Journal。token、stream chunk、stdout/stderr、file-read、心跳和采样 telemetry 必须进入各自的短期存储或观测通道。

## Consequences

Workspace activity timeline 可直接查询 Journal，不读取 AuditEvent 或推断 mutable snapshot。Projection 可从 baseline + tail 重建；snapshot 仍是加速手段。Application 调用方只学习一个 UoW interface，不需要理解 sequence、receipt 或事务步骤。

## Migration and rollback

0007 migration 只 expand：新增 heads、events、receipts、索引和 Journal UPDATE/DELETE/TRUNCATE 保护。回滚部署时保留表与事实，旧代码可继续读取 current state；不得以应用回滚为由删除 Journal。M10 contract 阶段之前保留 legacy importer 与 shadow reconciliation。
