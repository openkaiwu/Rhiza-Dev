# Project Architecture

> **文档地位（2026-09-06 刷新）**：本文是 **Current Implementation Snapshot**，只描述当前已落地行为；目标架构与开发顺序以 `docs/Rhiza_技术架构设计书_V4.2_20260829.md` 和 `docs/Rhiza_开发路线图_V4.2_20260829.md` 为准。M01–M08 的接受结论以 `docs/architecture-gates/` 中的 commit-bound evidence 为准；未配置 `DATABASE_URL` 时，真实 PostgreSQL 用例为 skipped，不视为通过。

## 1. Overview

根系（Rhiza）是基于产品设计书构建的全栈网页端 MVP。它验证“对话网络 + 显式上下文 + 当前知识状态”的核心产品命题，并通过动态 Provider Registry 连接多个 OpenAI-compatible 模型供应商。当前实现具备确定性 local user、Workspace membership、多个 Workspace 的创建/切换/归档与路径级 scope 隔离；领域数据默认由 embedded PGlite 持久化，也可连接 PostgreSQL。成功 Application Command 通过 WorkspaceUnitOfWork 在同一事务写 Current State、append-only Domain Journal 与 CommandReceipt；模型目录仍使用原子 JSON，API Key 使用本机 AES-256-GCM 密钥加密。

当前仓库不是 LibreChat fork。按 V4.2 基线，现有 `server/provider-*` 承担当前 API 配置的 Runtime Adapter 职责；`librechat-data-provider` 提供共享 Model Spec 与文件策略，Rhiza 的 Project、Node、Edge、Context 与 State 语义保持独立。后续迁移仍应扩展 Runtime 能力，而不是让 LibreChat Conversation/Mongo schema 进入 Rhiza Domain。旧映射仅见 `docs/archive/librechat-migration.md`，不定义当前架构。

## 2. Tech Stack

- React + TypeScript：界面与本地交互状态
- Vite：开发服务器与生产构建
- Express：Workspace、Context 与 Chat API
- OpenAI-compatible Provider：第三方模型适配、超时和错误归一化
- librechat-data-provider：LibreChat Model Spec、endpoint 枚举与文件能力策略
- Embedded PGlite：无 `DATABASE_URL` 时的默认真实事务后端，启动时按 checksum 自动执行同一套 PostgreSQL migration
- PostgreSQL Repository：`users`、`workspaces`、`workspace_members`、不可变 `ResourceVersion`、`workspace_events` 与 `command_receipts` 的事务更新、migration checksum 防篡改和 CI 真库验证
- Workspace Graph Projection：以通用 `ObjectRef` 注册 conversation/message/resource/run，以 Journal sequence + checksum 推进 checkpoint；显式重建写新版本并原子切换 alias
- JSON WorkspaceStore：仅保留 characterization fixture 与显式 `workspace:import-json` 迁移输入，不再作为生产默认后端
- content-addressed BlobStore：SHA-256 内容身份、temp write → verify → atomic promote，以及 grace-period orphan GC
- Lucide React：统一图标系统
- react-markdown / remark-gfm：Markdown 与 GitHub Flavored Markdown
- remark-math / rehype-katex / Mermaid：数学公式、LaTeX 和流程图渲染
- Vitest + Testing Library：组件行为测试
- 原生 CSS：设计令牌、响应式布局、动画和轻量点阵效果

## 3. Directory Structure

- `src/App.tsx`：顶层 Workspace/application coordinator，负责 Workspace 选择、API orchestration、持久化 mutation、streaming 与 layout-only state
- `src/components/AppShell.tsx`：纯展示 composition seam，负责 Sidebar、当前 Workspace surface、Context surface、backdrop 与 overlay layer 的空间关系；不得导入 API 或服务端实现
- `src/components/graph-model.ts`：当前 Workspace Graph 数据到 UI-facing graph model 的适配边界；`GraphView` 不直接消费持久化对象或 projector 内部字段
- `src/components/`：Chat、Graph、State、Sidebar、Context Inspector 等界面模块
- `src/data.ts`：MVP 演示数据
- `src/types.ts`：核心前端类型
- `src/api.ts`：浏览器 API 客户端与统一错误类型
- `server/http/app.ts`：legacy/default 与 `/api/v1/workspaces/:workspaceId` scoped HTTP 路由、local actor 注入、输入校验与错误边界
- `server/identity/`：Workspace directory、membership 与 ActorRef/ScopeRef scope policy
- `server/ai-runtime.ts`：Rhiza 自有的模型目录、生成请求与 Runtime Event 稳定契约
- `server/provider-runtime.ts`：当前 OpenAI-compatible Provider 到 `AIRuntime` 的临时适配器
- `server/librechat-shared.ts`：LibreChat Model Spec、文件策略与 Agent 消息格式适配
- `server/ai-provider.ts`：第三方 AI 协议适配与 Prompt 组装
- `server/provider-service.ts`：多供应商注册、模型发现、选择与调用编排
- `server/provider-store.ts`：供应商和模型目录持久化
- `server/secret-vault.ts`：API Key AES-256-GCM 加密与解密
- `server/application/ports/host-runtime.ts`：V4.2 当前 Chat 所需的 Host capability、Blob 与 credential seam；spawn/Desktop 明确不可用
- `server/application/run-lifecycle.ts`：Chat/临时 Chat 的 durable ExecutionRun 生命周期、取消、终态守卫与恢复协作
- `server/application/ports/workspace-unit-of-work.ts`、`server/infrastructure/workspace-repository-unit-of-work.ts`：Current State、Journal、Receipt 与 Run mutation 的事务边界
- `server/infrastructure/node-host-runtime.ts`：Node/headless Host adapter 与本机 content-addressed BlobStore
- `server/infrastructure/resource-backfill.ts`、`scripts/backfill-resources.ts`：旧 UUID 附件到 Resource/ResourceVersion 的幂等回填；BlobStore 的 GC 只接受调用方提供的完整 active-reference set，避免按单一 Workspace 误删共享 blob
- `server/store.ts`：JSON characterization fixture 与显式 legacy import 支持；不作为生产默认写路径
- `server/domain-journal.ts`：V4.2 M05 Event Catalog、Event Envelope、Receipt、semantic checksum 与活动时间线映射
- `server/contracts/graph-projection.ts`、`server/graph-projection/`：M07 的稳定 Graph DTO、纯查询/投影模型和 PostgreSQL checkpoint/alias adapter
- `server/embedded-store.ts`：PGlite 默认 adapter 与自动 migration；`scripts/backfill-journal.ts` 建立幂等历史 baseline
- `server/config.ts`：安全读取 Provider 环境配置
- `server/feature-flags.ts`：默认关闭、未知值快速失败的 M0 功能开关
- `db/migrations/`、`scripts/migrate.ts`：Rhiza 自有 PostgreSQL schema 与迁移器
- `e2e/`：跨真实 HTTP socket 的 Provider streaming 测试及 CI PostgreSQL 真库测试
- `.github/workflows/ci.yml`：lint、typecheck、unit、E2E、license 和 build 门禁
- `var/data/workspace.json` 及同目录 scoped Workspace 文件：运行时持久化数据，不提交 Git
- `var/data/providers.json`：加密供应商配置、模型收藏与置顶状态
- `src/test/`：测试环境初始化
- `src/components/RunHistory.tsx`：当前 Workspace 的执行历史、取消与重试入口
- `app/static/css/tokens.css`：可替换的设计令牌层
- `app/static/css/app.css`：稳定的样式聚合入口，按明确 cascade 顺序加载 surface 文件
- `app/static/css/base.css`、`shell.css`、`chat.css`、`graph.css`、`context.css`、`overlays.css`、`state.css`、`activity.css`：按展示 surface 所有权组织的组件与响应式样式
- `product-design.md`：从原始 Word 设计书提取的工作副本
- `docs/archive/librechat-migration.md`：历史 MVP 到 LibreChat Runtime clean-base 映射；不定义 V4.2 架构或 Milestone

## 4. Core Modules

- `App` 管理当前 Workspace 选择、主视图、活动讨论节点、节点/边集合、上下文条目状态与窄屏面板状态；切换时先清空旧 scope 数据，并用 generation guard 丢弃乱序响应。纯布局组合交给 `AppShell`，layout-only state 不承担持久化语义。
- `ChatView` 按活动节点过滤多轮讨论，使用 Selection API 捕获回答划线内容，并在当前讨论旁打开不落盘的临时支线工作台；用户显式保留后才固化为正式节点。
- `MarkdownContent` 负责 AI 输出的统一渲染：`react-markdown` + GFM、`remark-math` + KaTeX 数学公式，以及懒加载 Mermaid 流程图；消息组件不再直接输出 AI 原文。
- `Sidebar` 提供 Workspace 切换、创建、重命名、归档/恢复基础入口，并依据 `sourceNodeId` 构建可折叠节点树，提供活动路径、深度标识和深层路径聚焦。
- `ProviderSettings` 管理供应商连接和模型目录；`ModelSelector` 在调用前选择当前模型。
- `ContextPanel` 显示 Active、Recommended、Excluded Context 和预算。
- `GraphView` 只消费 `graph-model.ts` 暴露的展示模型，渲染真实讨论节点与语义边，并支持 Pointer Events 节点拖拽、空白画布平移、滚轮/按钮缩放、关系连接，以及节点归档/恢复与关系编辑；当前适配器从 bounded Graph API 生成该模型，每次加载 100 个对象；用户可继续加载后续页，加载失败可刷新重试，切换 Workspace 会清空旧图并丢弃迟到响应。
- `StateView` 区分当前有效事实、约束、决策与开放问题。
- `ActivityView` 从 Domain Journal 显示 workspace-local sequence 排序的低噪声语义活动，不展示 Runtime trace 或 transient stream。

## 5. Frontend Architecture

界面采用桌面三栏结构：左侧项目导航、中间主工作区、右侧 Context Inspector。窄屏下 Inspector 转为抽屉，移动端将主导航转为底部栏。视觉系统分为两层：`tokens.css` 定义色彩、字体、间距倾向、阴影和圆角；`app.css` 只消费这些语义变量。未来换肤应优先替换令牌，必要时再调整组件样式，避免侵入业务组件。

## 6. Backend Architecture

Express 后端暴露以下边界：

- PostgreSQL/PGlite 的 `executeCommand` 在同一事务内完成 command lock、receipt lookup、scope/revision guard、relational state 写入、完整 semantic reread/checksum、workspace sequence 预留、CloudEvents-compatible Journal append 和 committed receipt。相同 command id 直接返回既有 receipt。

- `GET /api/health`：服务与安全裁剪后的 Provider 状态
- `GET/POST /api/v1/workspaces`：按 local actor 列出或创建 Workspace
- `GET/PATCH /api/v1/workspaces/:workspaceId`、`POST /api/v1/workspaces/:workspaceId/switch`：读取、重命名、归档、恢复与切换 Workspace
- `/api/v1/workspaces/:workspaceId/...`：将 Workspace 领域读写映射到同一 Application handler，scope 只取路径，不信任 body
- `GET /api/workspace`：default Workspace 的兼容快照；旧 `/api/*` 写路径同样只作用于 default Workspace
- `PATCH /api/workspace/mode`：持久化 Context 控制模式
- `PATCH /api/workspace/context/:id`：持久化 Context 生命周期状态
- `POST /api/chat/stream`：先创建 durable Run，冻结输入与 Active Context，以 SSE 转发 Runtime Event；guarded completion 与消息、Manifest、Journal、Receipt 原子提交
- `POST /api/chat`：兼容性非流式入口，消费相同 Run 生命周期并返回最终结果
- `POST /api/attachments`：外部契约保持不变，内部执行 `RegisterResource`，先完成 blob 校验与 promote，再原子提交 Resource、ResourceVersion、materialization 与附件映射
- `POST /api/nodes`：从当前节点或消息锚点创建正式支线和 `derived-from` 关系
- `POST /api/temp-chat`：围绕选中锚点调用 AI；正式消息与节点不写入 Workspace，但执行 Run 仍保留审计终态
- `POST /api/nodes/:id/activate`：切换活动讨论节点
- `PATCH /api/nodes/:id/position`：持久化 Graph 节点坐标
- `POST /api/graph/nodes`、`DELETE /api/graph/nodes/:id`：创建图谱节点；普通 DELETE 仅归档并保留 Message、Segment、Manifest 与关系
- `PATCH /api/nodes/:id/status`：恢复已归档节点；归档期间对象和关系只读
- `POST /api/graph/nodes/:id/purge`：仅接受 archived leaf、精确 `PURGE <id>` 确认和审计原因；若节点有不可变 Run 输入或历史引用则以 `PURGE_HAS_EXECUTION_HISTORY` 拒绝
- `POST /api/graph/edges`、`DELETE /api/graph/edges/:id`：创建和删除语义关系
- `POST /api/nodes/:id/merge`：选择性合并支线摘要、写入主线引用并生成 `merged-into` 关系
- `GET/POST/PUT /api/providers`：读取、新增和更新安全裁剪后的供应商配置
- `POST /api/providers/:id/discover`：从兼容 `/models` 接口同步模型
- `PATCH /api/models/:id`：持久化收藏与置顶状态
- `POST /api/models/:id/select`：切换当前模型
- `GET /api/runs`、`GET /api/runs/:runId`、`POST /api/runs/:runId/cancel`：读取、检查和取消当前 Workspace 的 durable Chat Run；显式 Workspace 的取消也可走 `/api/v1/runs/:runId/cancel`

`ProviderRuntime` 实现 Rhiza `AIRuntime`，使用当前 Provider Catalog/API Key 把 OpenAI-compatible SSE 归一化为 `RUN_START`、一个或多个 `CONTENT_DELTA`、`RUN_END` 或 `RUN_ERROR`。模型目录通过 LibreChat `tModelSpecSchema` 形成 Model Spec，当前 endpoint 的文件数量、大小和 MIME 能力由 LibreChat file config 计算；Chat payload 采用 system/history/current-user 的角色化 Agent 消息格式。LibreChat 数据库对象不会进入 Rhiza Domain。

每个上传附件对应一个稳定 `Resource` 和一个或多个不可变 `ResourceVersion`。版本保存 `sha256`、`raw-v1` canonicalization、media type、size 与相对 `blob_ref`；路径和旧 attachment ID 不承担内容 identity。BlobStore 只有在 temp bytes 复算 digest 成功后才原子 promote，随后 Application/UoW 提交引用。因此数据库提交失败最多留下可由 grace-period GC 回收的 orphan blob，不会产生 committed dangling reference。读取用于 Chat 的版本必须再次校验 digest；损坏或缺失会显式失败，不回退到旧 UUID 文件。旧附件通过 `pnpm run resources:backfill` 幂等迁移，回填保留 attachment ID，并把 FileChunk 登记为 materialization 而不是 ResourceVersion。

`HostRuntimePort` 当前只冻结 file access、path normalization、Blob bridge、credential seam 与 capability descriptor。Node adapter 是 M04 的生产实现；spawn/PTY/process supervision 延后到 M24，Desktop 与真实跨平台 host matrix 延后到 M29。Domain/Application 不直接导入 Node OS 模块。

## 7. Data Flow

网页首次加载从 legacy `/api/workspace` 恢复 default Workspace，并据返回的 `projectId` 绑定 scoped 客户端；之后所有 Workspace 领域请求经 `/api/v1/workspaces/:workspaceId/...` 发送。HTTP 层为本地部署注入确定性 `ActorRef` 与路径派生的 `ScopeRef`，Application 层先验证 membership/scope，再进入对应 Workspace 的 Unit of Work。切换 Workspace 时前端先清空旧 scope 数据，乱序或失败响应不得回填旧 Workspace。每条 Message 归属一个 Discussion Node；Sidebar、Chat 与 Graph 共用 `activeNodeId`。

发送普通或临时 Chat 时，Application 先冻结 Workspace、Node、Model/ProviderEndpoint、ContextEnvelope 与 Manifest，并在 Tx A 创建 durable `ExecutionRun`、`run.created` 与 Receipt；外部 Runtime 调用不持有数据库事务。浏览器通过 POST SSE 消费 `CONTENT_DELTA` 并更新临时 Assistant Message。成功的 guarded Tx C 同时提交 completed Run、正式 Chat 的 User/Assistant Message、Manifest、Journal 和 Receipt；取消或失败各自保留不可变终态，晚到结果不得覆盖它。临时 Chat 不写正式消息或节点，但仍保存其执行输入和终态。AI Message 进入 `MarkdownContent`，先解析 GFM 和数学语法，遇到 Mermaid 代码块时懒加载图表引擎并在隔离容器中渲染。用户保留临时分支时，消息随 Node 与 `derived-from` Edge 原子写入。Sidebar 从节点的 `sourceNodeId` 计算树、活动路径和深度，不在存储中维护易失真的冗余 depth。

## 8. Testing Strategy

- `pnpm run lint`：覆盖前端、服务端、迁移和 E2E 的静态规则。
- `pnpm run typecheck`：同时严格检查浏览器与 Node 项目；服务端不再只依赖打包器转译。
- `pnpm run test:unit`：验证前端 API 接线、Context 持久化、输入校验、Provider 请求格式、架构边界和 Manifest 写入。
- `pnpm run test:e2e`：通过真实 HTTP socket 验证 provider request + SSE，并用嵌入式 PostgreSQL 引擎验证 schema 正反向迁移；CI 额外对 PostgreSQL 17 真服务创建 schema 并验证迁移幂等性。
- `pnpm run licenses:verify`：确保提交的生产依赖许可证报告可重复生成。
- `pnpm run build`：执行全量 TypeScript 严格检查、Vite 前端构建和 tsup 服务端构建。
- `pnpm run m04:checks`：在完整回归之上验证 Resource backfill/digest/fault injection、Node Host contract、Domain/Application OS import=0 与 M04 evidence 前置条件。
- `pnpm run verify:m05:closure`：完整回归、同一套 PGlite/可选真 PostgreSQL 事务 contract、100 重放/100 并发、三写点故障、append-only、baseline+tail checksum、HTTP 幂等与 strict-current evidence。真 PostgreSQL 未配置时明确 skipped。
- `pnpm run verify:m06:closure`：完整 M06 回归、M04 Host/M02 boundary/G0 前置检查与 strict-current ExecutionRun evidence；真实 PostgreSQL Run 用例未配置 `DATABASE_URL` 时明确 skipped。
- `pnpm run verify:m07:closure`：完整回归、10k object/50k relation bounded-query benchmark、投影增量 checkpoint、clean rebuild/alias 保留与 strict-current evidence；真实 PostgreSQL 投影用例未配置 `DATABASE_URL` 时明确 skipped。
- 浏览器人工验证：检查三栏布局、移动断点、滚动、抽屉、Graph 缩放/平移、节点/关系编辑和关键交互。
- Graph 组件与 API 测试：验证缩放、节点创建、归档/恢复、归档只读、受控 Purge、关系编辑及后端持久化。
- Markdown 组件测试：验证 GFM 表格/任务列表、KaTeX 公式和 Mermaid SVG 输出。

## 9. Development Conventions

- 组件使用明确的领域命名，避免把 Node 与 Message 混用。
- 视觉变量只能从 `tokens.css` 获取，新增一次性颜色前先扩展语义令牌。
- 图标统一使用 Lucide；品牌点阵为独立 `ParticleMark` 组件。
- 新行为必须覆盖正常交互路径，并保持无障碍名称与键盘焦点可见。

## 10. Known Constraints

- AI 回复已连接真实 Provider；执行时 Context Planner 从增量索引进行确定性选择，侧栏推荐与冲突提示的产品化仍属后续范围。
- Graph 已通过 bounded read-model API 读取 conversation 投影，支持缩放、平移、节点拖拽、节点归档/恢复、关系编辑与独立 layout 持久化；API 深度上限 3、对象上限 500、关系上限 2,000。框选、自动布局、超大图虚拟化及最终界面设计仍属于后续工作。
- 当前运行时在未配置 `DATABASE_URL` 时默认使用本机持久化 PGlite，配置后使用外部 PostgreSQL；两者共享 relational Repository、Domain Journal 与 migration。JSON 仅保留为测试 fixture 和显式 legacy import 输入。已支持 local user 下的多个 Workspace、membership 校验、跨 Workspace 隔离以及 Resource/ResourceVersion 元数据；尚不支持密码/OAuth/会话、成员协作或通用权限引擎。
- 当前 Provider/API Key 仍是唯一模型执行配置；已接入固定的 `librechat-data-provider@0.8.509` Model Spec 和文件策略。附件已通过 Resource/ResourceVersion 与 content-addressed BlobStore 注册、校验和回填；完整 Agent/MCP、统一 Auth、协作权限、跨设备同步、完整回放与 Portable Bundle 属于后续里程碑。
- Provider 适配范围是 OpenAI-compatible Chat Completions；非兼容协议需要新增 Adapter。
- 模型自动发现要求供应商实现 OpenAI-compatible `/models`；不支持时可手动添加模型 ID。
- 临时支线不跨刷新恢复，这是当前“未保留即丢弃”的明确产品语义；正式支线与 Graph 布局已持久化，Project State 编辑仍未接入持久化 API。
- Mermaid 与 KaTeX 会增加前端资源体积；Mermaid 采用动态加载，后续可继续拆分 Markdown 渲染入口或按消息能力加载。

## M06 Chat execution history

普通与临时 Chat 经 `server/application/run-lifecycle.ts` 创建 durable ExecutionRun，再调用 Runtime。`WorkspaceUnitOfWork` 的 RunMutation 与原有 Workspace mutation 共用事务：成功 Run、消息、Manifest、Journal 和 Receipt 原子提交，取消/失败单独留下终态。数据库 migration 0008 保护输入与终态不可变，trace 独立存储。

`GET /api/v1/workspaces/:workspaceId/runs` 与详情查询遵守现有 membership；同一 scope 的 `POST .../runs/:runId/cancel` 提供服务端取消，也提供 `POST /api/v1/runs/:runId/cancel`（显式 workspaceId）。RunHistory 显示状态、hash、模型/endpoint、错误、telemetry 与新 Run 重试入口。启动恢复在接收请求前执行；PostgreSQL 使用单 runtime advisory lock。语义边界见 ADR-006。

## M07 Workspace graph projection

Graph read model 将 Current State 与 durable ExecutionRun 投影为通用 `ObjectRef`/relation DTO。普通查询在 Journal checkpoint 变化时于现有 projection namespace 内事务更新对象、关系与 checkpoint；`pnpm run graph:rebuild` 或 rebuild API 写入新 namespace，在完整提交后原子切换 alias，并保留旧 namespace 供回滚。默认 layout 独立存放于 `graph_layout_nodes`，legacy node 坐标只作迁移回退。

Application 仅依赖 `WorkspaceUnitOfWork` 的 graph query 契约；HTTP 提供 neighborhood/path/tree/changes 与 rebuild。前端只请求 conversation family，并由 `graph-model.ts` 把 bounded DTO 适配为 GraphView 的窄展示模型。M08 已实现 Context Runtime v1，最终 UI 由 M18 定义。语义与回滚约束见 ADR-007。

Graph 查询在 Workspace 写锁内读取 Current State、全部 Run 与删除事件，再与 projection checkpoint 一起提交；普通推进仅写入变化的对象和关系。删除事件不受 activity feed 的 10,000 条窗口限制。重建只回填缺失的 layout，不覆盖用户坐标或 collapsed 状态；layout 不参与 graph semantic checksum。迁移 `0010_graph_object_metadata` 保留 ObjectRef 的版本引用和来源锚点。

列表 cursor 同时推进对象页和关系页并绑定 checkpoint；跨页关系保留在 App 中，只有两端均已加载时才展示。checkpoint 变化返回 `GRAPH_CURSOR_STALE`，调用方刷新后从第一页重新读取。`changes` 的 checkpoint 不一致时返回 `resetRequired`，完整恢复通过有界列表分页完成。旧 Workspace snapshot 继续服务 Chat 与兼容写入口；GraphView 的数据源为 Graph API。

## M08 Context Runtime v1

`context-runtime/contracts.ts` defines source contributors, a bounded CandidateIndex, deterministic Planner, freezing Compiler and historical resolution outcomes. `IndexedContextPlanner` uses the same extracted `planCandidates` selection logic as the legacy entrypoint and fingerprints input/source/index/runtime versions before reusing a copied plan. The production Node composition root now selects the indexed Planner for PostgreSQL/PGlite. Source writes maintain affected candidate rows in the same transaction; query audits include the actual SQL statements and returned row counts. Existing databases can explicitly backfill the derived index with `pnpm run context:rebuild`. Production Chat preparation reads the active conversation, selection and explicitly requested attachments through a scoped repository query; regenerate lineage is resolved alongside those messages. Full active-node history is retained for message version semantics. The Blob Compiler freezes exact selected text in raw-v1 JSON snapshots. Context-source Resources and immutable ResourceVersions commit with Run creation before provider dispatch; successful messages commit with Manifest v1. Migration 0012 validates scoped version/digest references and denies v1 UPDATE/DELETE, including the legacy purge switch. Historical endpoints resolve by Manifest ID or either message of a completed turn and read verified frozen bytes, with explicit missing/legacy outcomes. Each message can open a historical ContextPanel showing selected order, frozen versions, integrity outcomes and recorded omission reasons. Planner omissions and cache identity are persisted in Manifest v1. Returning to current selection or changing Workspace invalidates in-flight history responses. The full M08 gate and visual acceptance passed; commit-bound evidence is archived under `docs/architecture-gates/M08/`. ADR-008 defines the accepted contract. Compiler belongs to Application and uses the existing BlobStore port; shared canonical serialization belongs to Domain, preserving module and Host dependency boundaries.
