# ADR-001: 模块依赖方向与边界执行方式

- Status: Accepted
- Date: 2026-08-23
- Baseline: Rhiza Architecture & Roadmap Baseline V4.0, M01
- Carried forward: V4.2; implementation accepted through M02 boundary evidence
- Supersedes: none
- Superseded by: none

## Context

作出本决策时，V4.0 §3 将 Core 定义为 `Application → Domain` 的依赖方向；Infrastructure、Runtime Adapter 与 Host Adapter 只实现 Ports，Web 只经 HTTP/API contracts 到达服务端。当时 `server/app.ts` 仍同时承担 Express 路由、编排和 `WorkspaceRepository` 调用。当前实现已将 Application、HTTP 与 Infrastructure 分区；本 ADR 的决策仍由 V4.2 保留。

## Decision

M01 以 ESLint `no-restricted-imports` 建立可执行的目录边界：`server/domain.ts` 及未来 `server/domain/**` 禁止 Express、`pg`、`node:fs`；`src/**` 禁止 `server/**` 内部导入；未来 `server/http/**` 禁止 persistence adapter 导入。`scripts/boundary-gates/boundary-lint.test.ts` 以故意违规的源码片段验证三条规则都会红灯。

唯一的过渡例外是 `server/app.ts` 注入并调用 `WorkspaceRepository`。它是 Legacy composition/route 文件，不属于未来 `server/http/**` 分区；登记在 `scripts/boundary-gates/boundary-exceptions.json`，Owner 为 M02 Application-boundary implementer，Issue 为 `INH-8 / M02`，到期日为 **2026-09-30**（亦即 M02 Blocking Acceptance 前）。边界负向测试会验证每项例外都有 owner/issue 且未过期；例外不得扩展到新的 HTTP 文件或新的 persistence adapter 调用。

## Alternatives considered

- 只保留 `server/architecture.test.ts` 的正则检查：无法阻止新路径的违规导入，拒绝。
- 立即移动全部目录并拆 Application：这是 M02 的明确范围，M01 不提前重构。
- 使用独立 npm packages：V4.0 §3.2 明确当前先用目录分区与 ESLint，拒绝。

## Consequences

新模块在创建时即受边界保护；违反会在 lint 和负向测试中失败。规则会随 M02 目录迁移从临时 `server/domain.ts` 扩展位置收敛，而不是改变依赖方向。当前 `app.ts` 仍是已记录的架构债务，不能据此声称 HTTP 已经通过 Application。

## Migration and rollback

M02 创建 `server/domain/`、`server/application/`、`server/http/` 后，将路由改为 Application facade，并移除上述例外。若 M01 规则阻断了错误的迁移提交，先修正导入；只有回滚整个 M01 时才随代码 `git revert` 本 ADR 和 ESLint 规则。

## Supersession

本 ADR 在模块方向、Port 语义或边界工具发生高成本变化时由新 ADR supersede；普通目录移动不需要新 ADR。
