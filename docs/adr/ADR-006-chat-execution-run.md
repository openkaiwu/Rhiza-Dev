# ADR-006: Chat ExecutionRun、取消与崩溃恢复

- Status: Accepted
- Date: 2026-08-31
- Baseline: V4.2 / M06

## Decision

当前普通 Chat 与临时 Chat 的外部模型调用必须先创建 `execution_runs`，再调用 Runtime。复用项目已锁定的 PostgreSQL/PGlite、原生 AbortController 与既有 Provider Adapter；没有新增 SDK、工作流引擎或第三方代码。执行编排属于 Rhiza Application；Runtime 仍只负责模型协议，不写 Message/Manifest。

状态为 `created → dispatching → running → completed`。任何非终态可转为 `failed`、`canceled` 或 `interrupted`；终态不可修改。每个 Run 的 attempt 固定为 1，Retry/Regenerate 创建新 Run，以 `parentRunRef` 表达谱系。输入、hash、模型/endpoint identity 与谱系由数据库约束保护。跨 workspace 的 parent 由复合外键和 Application scope 检查拒绝。

Tx A 在 UoW 内创建 Run、`run.created` 和 committed receipt。`run:create:<commandId>` 保证并发重放不会重复调用 Provider。派发和开始运行分别提交低频生命周期事实。外部调用不持有数据库事务。Tx C 以 run ID、attempt、running status 做 guarded update，并把 completed、User/Assistant Message、Manifest、`conversation.run.committed`、`run.status.changed` 和 Receipt 放在同一事务中。Message 写失败时 completed 同步回滚；随后独立记录 failed。存储不可用时拒绝宣称完成，残留非终态由下次启动恢复。

取消先提交 canceled、cancelRequestedAt、telemetry 和 Receipt，再 abort 进程内请求。取消与成功争用同一 Workspace 事务锁；先提交的终态获胜。取消 API 可在 Chat 之外调用。SSE 断开仍触发中止，但不是唯一停止入口；Provider 无视 AbortSignal 时也不能覆盖终态。缺失 RUN_END 映射 interrupted，不合成成功结果。执行协调器另有 120 秒总时限，Provider 原有超时仍有效。

ContextEnvelope v1 保存实际 RuntimeRequest（不含 signal/credential）、runtime 标识和模型快照，使用规范化 JSON 的 SHA-256。现有 model UUID 直接作为 ModelSpec ref，现有 provider UUID 作为 ProviderEndpoint ref；目录读取即提供映射，旧 ID 不重发，不需要修改已有目录文件。请求冻结模型名、endpoint 路径与配置版本；派发前若目录版本变化则失败为 PROVIDER_CONFIGURATION_CHANGED，避免把更新后的凭据发送到旧 endpoint；凭据只在 Provider Adapter 中读取，不进入 Run/trace。历史 envelope 是审计输入，不能依靠当前活动模型反推。

TraceSink 每 128 条等待批量写入 `execution_run_traces`，唯一键为 `(run_id, attempt, sequence)`；只记录类型、序号和时间，不保存原始错误或 token 内容。TransientStreamSink 是 256 项易失 ring，SSE 写入等待 drain/close。正常成功 Run 的 Journal 事实数为 5，失败/取消不超过 5；10k trace 不改变这个界限。telemetry 保存 TTFT、总时延、usage（保留 estimated 标记）、trace 数与 error class；统计必须同时按 ModelSpec ref 和 ProviderEndpoint ref 分组。

错误分类为 canceled、timeout、provider、network、interrupted、commit。用户只看到固定安全文案与错误代码；不保存上游错误原文。

## Recovery and deployment

启动接受请求前，PostgreSQL host 先取得专用 session advisory lock，防止第二个 host 把仍在执行的工作错误恢复；然后把所有非终态标记为 interrupted，追加同事务事件/receipt，不自动重发 LLM。Embedded 模式沿用单进程、单数据目录部署约束。Run UI 通过服务端查询每两秒刷新，以数据库终态收敛。

0008 是 additive migration。生产 PostgreSQL 先运行 `pnpm run db:migrate`，embedded 启动自动迁移。部署前备份数据库；应用回滚保留新表，禁止自动 down 删除执行历史。临时对话仍不创建正式节点或消息；它的 Run 输入与终态属于持久执行审计，因此会保留在本地数据库。

本阶段仅支持 `side_effects=false` Chat。Assignment、RunGroup、pause/resume、CLI/Agent 的 lease/fencing/approval 不进入状态机，留给 M24–M26。
