# Rhiza / 根系

> **Complex Human–AI Work Runtime**<br>
> 让复杂的 Human–AI 工作保持可理解、可组织、可追溯、可控制。

Rhiza 是一个面向长期、复杂 AI 工作流的 Workspace。它不把聊天记录当作最高层抽象，而将对话、上下文、知识、决策、任务、执行与产物组织为同一工作空间中的可追溯对象。

当前仓库提供了一个可运行的 Web MVP：以节点级对话、显式 Context、不可变 Manifest、分支和 Conversation Graph 验证产品体验。它是当前实现快照，不是目标 Kernel；目标与施工顺序以 **Rhiza Architecture & Roadmap Baseline V4.1** 为唯一权威。

## 愿景

当模型、CLI 与 Agent 的执行速度和自主性持续提高，用户仍应能回答这些问题：

- 我们在推进什么？已经形成了哪些事实、决策与产物？
- AI 在这一次执行中读取了什么，为什么？
- 哪些工作可并行、由谁负责、依赖或冲突在哪里？
- 一个执行过程改变了什么，是否需要人介入？
- 我配置的不同模型与服务路径，实际分别擅长什么？

Rhiza 不试图替代 Codex、Claude Code、OpenClaw 或其他执行器内部的 Agent loop。它负责理解和协调长期工作：组织上下文与任务、委派有范围的执行、接收轨迹与产物、解释影响、管理权限，并保留可回放的事实。

```text
Human / LLM / CLI / Agent / Tool
              │
              ▼
┌───────────────────────────────────────────┐
│                    Rhiza                  │
│  Work Graph · Context · Task Coordination  │
│  Execution Observability · Model Routing   │
└───────────────────────────────────────────┘
              │
              ▼
    Understandable, controllable work
```

## 产品原则

- **Workspace 高于 Conversation**：对话是探索入口；Goal、Task、Knowledge、Decision、Artifact、Context 与 Execution 共同构成长期工作状态。
- **Graph 是通用表示**：Conversation、Task、Knowledge、Execution 与 Impact 是同一 Work Graph 的不同投影，不应各自维护事实来源。
- **事实优先于当前视图**：关键历史需保留 provenance 和版本；current state 与 UI projection 都不是唯一真相。
- **Context 必须显式且可回放**：每次调用都以不可变 Context Manifest 记录输入、角色、来源、排除项、预算与选择理由。
- **Rhiza 管理任务状态，执行器管理执行策略**：外部 Agent/CLI 只获得完成 Assignment 所需的上下文、资源与权限；结果作为 Event、Artifact 与 Effect 回流。
- **控制面保持轻量**：Domain Event、Execution Trace 与实时 Stream 分离；高频轨迹、语义分析与投影不能阻塞用户主路径。
- **人始终可以理解与覆盖系统决策**：自动检索、路由、委派与协调必须可解释、可审计、可关闭。
- **核心保持 Headless、工作空间保持可迁移**：平台能力经 Host Adapter 注入；正式迁移格式是版本化 Portable Workspace Bundle，而非数据库 dump 或绝对文件路径。

## 当前可用能力（MVP）

M0–M6 已验证的 Web 体验聚焦于“复杂对话 → 可追溯 Context 工作空间”：

- 节点级多轮讨论、从任意回答建立临时或正式支线，以及选择性合并回主线。
- Conversation Graph：节点与语义关系的创建、删除、缩放、平移、拖拽和持久化布局；Chat、树与图共享活动节点。
- `Auto`、`Assisted`、`Strict` 三种 Context 模式；Active / Recommended / Excluded 管理、Pin/移除/排除与预算提示。
- 不可变 Context Manifest：每次完整模型调用冻结来源、选择理由、内容版本、模型、生成参数和请求 ID；历史回答可查看其快照。
- 确定性本地 Context Planner：在 Node、Segment 与文件片段间进行混合检索，显式上下文优先，自动结果只使用剩余预算。
- OpenAI-compatible 多供应商接入、模型发现、收藏/置顶、动态模型选择，以及真实 SSE 流式输出、停止、重试、重新生成和编辑重发。
- 文件上传与附件上下文、Markdown/GFM、代码、LaTex、Mermaid、Reasoning、Tool Call 与 Token Usage 展示。
- JSON 默认存储与可选 PostgreSQL Repository；原子写入、版本化消息、审计事件、事务迁移和 checksum 校验。
- 响应式 Web 界面、首次引导、命令面板、快捷键、离线/错误/空状态恢复，以及 lint、类型、单元、E2E、构建与许可证门禁。

当前 MVP 使用 Rhiza 自有领域模型。它选择性复用锁定的 `librechat-data-provider` 进行 Model Spec 校验、endpoint 归一化与文件策略；LibreChat 的 Conversation/Mongo 领域模型不会成为 Rhiza 的事实来源。旧迁移边界说明仅作[历史归档](docs/archive/librechat-migration.md)阅读，现行边界以 V4.1 基线为准。

## 目标架构（V4.1 基线）

当前实现是产品假设的起点，不是最终 Kernel。接下来的架构重置会将现有能力迁移到以下分层，同时保持既有用户路径：

```text
Client surfaces: Web / Desktop / future clients
                    │ Rhiza Protocol / IPC
                    ▼
              Headless Rhiza Core
 Workspace · Task · Context · Work Graph · Coordination · Routing
        ┌───────────┼─────────────────────┐
        ▼           ▼                     ▼
Control / State  Projection Plane    Execution Plane
Transactional    materialized views  router + providers
state + event    search / graph /    trace ingestion +
journal          semantic workers    transient live stream
```

长期 Core 只稳定领域与协议边界：Identity/Scope、Event、Context、Execution、Capability、Permission/Policy、Executor/Assignment、Lease/Handoff、Storage/Resource、Host Runtime、Portable Workspace 与 Extension。具体 LLM、Planner、Agent loop、CLI、MCP、Search、UI 和存储实现均应可替换。

关键演进对象包括：

```text
Workspace · Goal · Task · TaskPlan · Workstream · Assignment
Conversation · Knowledge · Decision · Artifact · Resource
ContextManifest · ExecutionRun · ExecutionEvent · Effect
Dependency · Risk · ModelSpec · ProviderEndpoint · RoutingDecision
ExecutorProfile · RunGroup · Handoff · Extension
```

## 路线图

| 阶段 | 目标 | 重点 |
| --- | --- | --- |
| Phase 1 — Foundation of Complex Work | 将对话体验建立在长期可演进的基础之上 | Event Journal、Universal Work Graph、`ExecutionRun`、Context Runtime、Replay/Provenance、Closed Beta |
| Phase 2 — Complex Task Workspace | 从复杂对话扩展到复杂任务 | Goal/Task/Workstream、Resource/Knowledge、Multi-view Graph、Adaptive Routing v1、Execution Federation、同 Workspace 多 Executor 协作 |
| Phase 3 — AI Work Control Plane | 协调多 Agent、CLI 与扩展生态 | Delegation/Lease/Approval、跨 Workspace Mission、Impact Graph、Capability Map、长任务自动化、Extension Registry |

近期施工顺序为：冻结当前 M6 → Architecture Reset → Event Journal / Identity / Scope → `ExecutionRun` 与 Endpoint telemetry → Universal Work Graph → Context Runtime → Replay / Provenance → 重新产品化与 Closed Beta。路线图描述的是目标状态，不代表这些能力已在本仓库完成。

目标架构与正式施工路线见 [技术架构设计书 V4.1](docs/Rhiza_技术架构设计书_V4.1_20260824.md) 与 [开发路线图 V4.1](docs/Rhiza_开发路线图_V4.1_20260824.md)。当前实现结构见 [docs/architecture.md](docs/architecture.md)。

## 本地运行

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm run dev
```

> Windows PowerShell 请使用 `Copy-Item .env.example .env`。

开发环境网页地址为 `http://127.0.0.1:4173`，后端健康检查为 `http://127.0.0.1:8787/api/health`。

生产式本地运行：

```bash
pnpm run build
pnpm start
```

默认打开 `http://127.0.0.1:8787`，由同一个进程提供网页与 API。

## 配置 AI Provider

打开左上角“模型与 API 设置”，选择 OpenAI、OpenRouter、DeepSeek、SiliconFlow、Ollama 或自定义供应商，填写 Base URL、API Key 和至少一个模型 ID。保存后可从 `/models` 同步目录、切换当前模型、收藏和置顶模型。

任何支持 `/chat/completions` 的服务均可通过环境变量初始化：

```env
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=your-secret-key
AI_MODEL=your-model-name
AI_PROVIDER_NAME=Your Provider
```

本地 Ollama 等无鉴权服务示例：

```env
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_API_KEY=
AI_ALLOW_NO_KEY=true
AI_MODEL=qwen3:8b
```

首次启动且模型目录为空时，后端会用 `.env` 初始化一个供应商。之后可在网页中管理供应商和模型。API Key 会以本机生成的 AES-256-GCM 密钥加密保存到 `var/data/providers.json`；密钥保存在 `var/data/.provider-key`，两者均不会提交 Git，也不会通过 API 回显。

## 数据与功能开关

默认使用本地 JSON 兼容后端。提供 `DATABASE_URL` 并显式开启 PostgreSQL 后，可切换到带连接池、事务和审计记录的 PostgreSQL Repository：

```env
RHIZA_FEATURE_FLAGS=postgresPersistence=true,libreChatRuntime=false,fileContext=false
```

可用 `RHIZA_PROJECT_ID` 指定要恢复的 Project UUID。未知开关或非法值会让服务快速失败；未完成能力默认关闭。

如需验证 PostgreSQL migration baseline，请先提供一个空测试库：

```bash
DATABASE_URL=postgresql://rhiza:rhiza@127.0.0.1:5432/rhiza_test pnpm run db:migrate
DATABASE_URL=postgresql://rhiza:rhiza@127.0.0.1:5432/rhiza_test pnpm run db:status
```

迁移按文件名排序、逐个事务执行并记录 SHA-256 checksum；重复执行不会重复建表，已应用 SQL 被改写时会失败。

## 验证

```bash
pnpm run verify:m6
```

该门禁串联 lint、严格 TypeScript 检查、单元测试、E2E、许可证一致性与生产构建。也可按里程碑运行 `verify:m0` 至 `verify:m5`，或使用 `pnpm run benchmark:m5` 运行 Context Planner 基准。仓库以 `pnpm-lock.yaml` 与 `packageManager` 字段固定 pnpm 版本；不要混用 npm 生成第二份 lockfile。

第三方许可证报告可重复生成并核对：

```bash
pnpm run licenses:generate
pnpm run licenses:verify
```

报告写入 `reports/third-party-licenses.json`。

## 文档索引

- [V4.1 目标架构](docs/Rhiza_技术架构设计书_V4.1_20260824.md)
- [V4.1 开发路线图](docs/Rhiza_开发路线图_V4.1_20260824.md)
- [当前实现架构](docs/architecture.md)
- [产品概念与交互模型](product-design.md)
- [LibreChat 复用与迁移边界（历史归档）](docs/archive/librechat-migration.md)
- [M0–M6 验收记录](docs/)
