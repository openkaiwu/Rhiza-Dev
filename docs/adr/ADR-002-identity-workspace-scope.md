# ADR-002: Identity、Workspace 与 Scope

- Status: Accepted
- Date: 2026-08-23
- Baseline: Rhiza Architecture & Roadmap Baseline V4.0, M01
- Supersedes: none
- Superseded by: none

## Context

当前 MVP 使用单一 `DEFAULT_PROJECT_ID`，没有 User、Workspace membership 或命令 Scope。V4.0 I-01/I-02、§4 和 §5.4 要求 Workspace 成为所有权根，并要求每个 Command 带 `ActorRef` 与 `ScopeRef`；这也是未来共享部署和可移植数据的前提。

## Decision

M03 将引入最小 `User`、`Workspace`、membership、`ActorRef` 与 `ScopeRef`。所有长期 Domain Object、Event、Manifest、Run、Resource 与 Projection 必须携带 `workspace_id`；Application 入口在读写前校验 Actor 的 workspace membership 和 Scope。跨 workspace 引用必须显式建模，不能通过路径、全局 project id 或隐式默认值共享事实。

本地单机首启可确定性 bootstrap 一个 local user/workspace；HTTP 只预留 actor-resolution seam，不在此决定密码、OAuth、session、RBAC 或 ABAC。

## Alternatives considered

- 保留 Project 单例并以后再映射 Workspace：会让历史所有权和迁移不可判定，拒绝。
- 在 M03 一次实现完整 IAM：超出 V4.0 最小身份范围，拒绝。
- 以 Conversation 作为所有权根：违反 I-01，无法承载 Task、Resource、Execution，拒绝。

## Consequences

所有新 command contract 和持久化 schema 都需明确 workspace 与 actor/scope；查询默认必须 scoped。旧单机数据需要一次确定性的 workspace backfill，API 需要处理无 scope 的 compatibility facade。真实认证策略保留到 Beta 前的 ADR-011（如需要）。

## Migration and rollback

按 expand/contract 增加 identity/workspace 表、为现存数据写入 bootstrap workspace，再切换 scoped reads/writes；迁移期间保留只读 compatibility lookup。发现 ownership backfill 错误时停止切换、用映射日志恢复并重新执行，不删除旧数据。完整收缩和回滚窗口由 ADR-010/M10 定义。

## Supersession

共享部署认证、角色模型或 identity namespace 的破坏性变化必须以 ADR supersede 本决策；新增普通 profile 字段不需要。
