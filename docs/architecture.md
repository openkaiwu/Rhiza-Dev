# Project Architecture

> M09 核心功能与 M10 唯一生产写路径已完成工程收口；正式 M09/M10 Gate 仍待外部证据。下述原有门禁结论只覆盖各自验收提交。

M10 决策见 [ADR-010](adr/ADR-010-production-write-cutover.md)，操作见 [M10 operations](m10-operations.md)。生产 Application/UoW 缺少 Command context 或事务适配器时拒绝变更；关系存储 `update()` 已关闭。普通变更采用显式新增、更新、删除集合，历史 Message/Manifest/ResourceVersion 禁止通用覆盖，项目 JSON 只合并变化字段。初始化、Bundle 激活、资源回填、投影重建和恢复保留明确入口。Purge 使用受影响对象清单处置事务内删除与脱敏，继续用 tombstone/checkpoint 保证提交后不可读与幂等撤钥。JSON Store 仅为迁移输入/fixture；生产使用 PostgreSQL/PGlite。旧入口只读观测为进程窗口计数，不能代替 24 小时证据。

Bundle staging 已接通归档文件、固定 schema 解码、引用/内容/历史最终状态对账，并在失败时清理临时目录。生产导入、解包、恢复和导出的工作文件位于项目私有 imports/transient 目录；服务启动时（取得运行时独占权后）清理遗留目录，强制中断后不长期保留明文。当前操作配额：Workspace JSON 为 64 MiB，JSON 嵌套深度最多 128，index/layout 为 16 MiB；Blob 仍按独立的流式归档配额处理。导出同样执行文档大小限制。迁移 0014 新增独立的导入 checkpoint 元数据：绑定用户、Workspace 和归档/状态摘要，幂等创建、版本化阶段推进，数据库拒绝身份修改和阶段倒退；该表不提前创建目标 Workspace。Application 经 UnitOfWork 将空目标的 Workspace、成员、Run、Provenance、Journal 和 activated checkpoint 写入同一事务；失败全部回滚。导入端把 portable `sha256` 内容按目标 `{workspaceId, resourceVersionId}` 重新封装为 `sealed-v1`，再把目标存储事实交给激活事务；portable facts 仍用于归档 identity/history/stateDigest 校验。恢复用归档按原 ZIP digest 建立独立 AES-GCM 密文与密钥，checkpoint 更新后保留七天；启动或停服维护时根据所有仍在恢复窗口内的 checkpoint pin 撤销过期归档密钥并回收密文。旧版明文保留 ZIP 经完整校验、密封与读回验证后移除。生产 composition root 的新 ResourceVersion、附件与 Context Blob 默认使用同一 scoped 加密适配器；旧 `sha256` 引用仅保留只读迁移能力。迁移 0029 允许并约束 scoped 引用，`pnpm run resources:seal-blobs` 在停服独占运行时按 Workspace 分批迁移旧 Blob，读回摘要和大小一致后才更新引用；原明文须等待全库引用与 Bundle/GC pin 审计后再清理。Bundle activation retains coarse transaction locks and rejects global ID collisions; ordinary production writes now use the ADR-010 change sets. 已验证新 PGlite 库的事实往返、Journal 阶段回滚、数据库重开恢复、图投影和继续对话；本地嵌入式及隔离 PostgreSQL 的进程级中断恢复亦已验证。完整里程碑验收仍待完成。

进程级 SIGKILL 故障注入覆盖 validated、blobs-ready 与未提交激活事务后的重启恢复，分别在嵌入式和隔离 PostgreSQL schema 上执行；上传期间中断留下的 transient 明文由独立故障注入验证回收。用户管理的 staging 数据迁移、备份保留与 M09 Gate 仍需独立验收。

> **文档地位（2026-09-06 刷新）**：本文是 **Current Implementation Snapshot**，只描述当前已落地行为；目标架构与开发顺序以 `docs/Rhiza_技术架构设计书_V4.2_20260829.md` 和 `docs/Rhiza_开发路线图_V4.2_20260829.md` 为准。M01–M08 的接受结论以 `docs/architecture-gates/` 中的 commit-bound evidence 为准；未配置 `DATABASE_URL` 时，真实 PostgreSQL 用例为 skipped，不视为通过。

## 1. Overview

M09 的标准 Embedded/PostgreSQL factory 已默认配置成功回执密文存储。迁移 0015 的 `result_content_ref` 与明文 `result` 互斥；三条成功回执写入和三条幂等读取路径统一处理，确认事务回滚时销毁新建密钥，COMMIT 响应不确定时保留。Embedded 配套目录为 `<dataDirectory>.content`，PostgreSQL factory 默认 `var/receipt-content`；这些目录需随数据库共同备份。旧回执、拒绝回执的 error、Run/Journal/其他正文迁移及完整 Purge 尚未完成。

Bundle 导入先在 Workspace 写锁下检查目标并写身份绑定的 validated checkpoint，再在同一 Workspace/内容生命周期锁保护下保留独立密钥加密的恢复 ZIP；激活时仍复查目标占用。导入与 Purge 同时锁定归档摘要，Purge 因此能发现另一 Workspace 尚未提交的同摘要导入，拒绝撤销共享密钥；旧 Purge 撤销未完成时的新导入失败关闭，完成后可释放已撤销描述符并以新密钥导入。Purge 事务把所有关联导入摘要登记为待撤销引用，提交后幂等销毁归档密钥；恢复窗口内的归档 pin 不覆盖已提交 Purge，已撤销描述符由维护回收。缺少归档适配器或检测到旧明文 ZIP 时，Purge 在提交前失败关闭；Purge 后的同目标重试导入在保留归档前失败。已验证 validated、blobs-ready、activated 的旧记录不能仅按七天时间放行。外部用户控制的导出依 ADR-009 仍不可召回；Run/资源等其他副本及备份边界仍阻断完整 Purge 验收。

服务在取得运行时独占权后先初始化默认 Workspace 并幂等补齐 Journal baseline，再开放 Bundle 导出；新库首轮导出不依赖手工 backfill。已有 Journal tail 却缺失首事件 baseline 时仍由 `JOURNAL_BASELINE_ORDER_CONFLICT` 阻止启动，不重排历史。

根系（Rhiza）是基于产品设计书构建的全栈网页端 MVP。它验证“对话网络 + 显式上下文 + 当前知识状态”的核心产品命题，并通过动态 Provider Registry 连接多个 OpenAI-compatible 模型供应商。当前实现具备确定性 local user、Workspace membership、多个 Workspace 的创建/切换/归档与路径级 scope 隔离；领域数据默认由 embedded PGlite 持久化，也可连接 PostgreSQL。成功 Application Command 通过 WorkspaceUnitOfWork 在同一事务写 Current State、append-only Domain Journal 与 CommandReceipt；模型目录仍使用原子 JSON，API Key 使用本机 AES-256-GCM 密钥加密。

M09 当前实现：新 Assistant output 在原事务内写入 `provenance_links`。`GetProvenance` 通过 Workspace membership 与 scoped UnitOfWork 读取来源关系，检查 Run、Manifest 与冻结内容缺失；旧输出按实际证据标记 pre-run。Purge 删除输出或其关联输入/Manifest 时，同一事务把受影响关系改为显式 `purged`，保留逻辑身份并阻止查询层把它误报为普通 broken-reference。迁移 0030 同时持久化 Purge checkpoint 及逐项 scoped key 引用；迁移 0031 为不可变 Journal 行提供有效载荷脱敏覆盖层，同一 Purge 事务发布可重放的脱敏 baseline/tail 并登记旧密钥。无密文载荷或可重放 baseline 时拒绝 Purge。SQL 提交后在内容生命周期独占锁内幂等撤销密钥，服务启动会分批排空 pending checkpoint，撤销无法继续时不开放 HTTP 服务。撤销中断不恢复已删除正文，读取保持 fail-closed；密钥已销毁但 SQL acknowledgement 未落盘时可安全重复。当前 checkpoint 覆盖被删除的 Node、Message、Manifest、Segment、Anchor、Edge、ContextItem、Journal、CommandReceipt、终态密封 Run 和保留导入归档密钥；旧明文/活跃/跨节点 Run 及未覆盖资源历史仍拒绝，尚不能宣称完整 crypto-shred。跨节点保护会读取旧明文与密封 Run 输入，检查 `sourceMessageId`、Manifest、history、Context 来源和谱系等结构化引用，不能只比对 Run 的节点 ID。迁移后可执行 `pnpm run provenance:backfill` 幂等回填现有输出，脚本不初始化缺失的 embedded 数据库。Replay Command 直接消费历史 Run request 与冻结 Manifest，经现有 RunLifecycle 创建有 parentRunRef 的新执行，记录显式 replay policy；历史版本或内容缺失时不派发。Exact 校验 runtime/model/endpoint 配置，Partial 与 Current-model 由调用方明确选择。API 为 `/api/v1/workspaces/:workspaceId/objects/:outputId/provenance` 与 `/api/v1/workspaces/:workspaceId/runs/:runId/replay`。Purge 剩余副本迁移与里程碑全量验收仍在开发范围内。

新 Run trace 写入仅接受 Runtime 协议事件类型，并将每条记录投影为 `sequence/type/at`，不持久化流式正文或调用方附带的其他字段。`pnpm run m09:traces:audit` 全库检查既有 trace 行的字段和类型；停服后可用 `RHIZA_OFFLINE_TRACE_SANITIZATION=1 pnpm run m09:traces:sanitize` 分批清除旧行的附加字段，保留可信的 sequence/type/at，格式不可信时失败关闭。正式 staging 仍需执行迁移和审计。

Purge 事务在登记密钥前逐项对账被删 Node、Message、Manifest、Segment、Anchor、Edge 的 SQL 行数与密文引用；任何正文族缺适配器、缺行或仍为旧明文时先拒绝，不把删除 SQL 行当作 crypto-shred。旧内容须通过现有分批密封迁移完成后重试；该保护与 Journal/Receipt/Resource 的独立前置校验共同组成提交边界。

迁移 0032 将 Purge 前已密封的 CommandReceipt result/error 纳入同一 checkpoint；SQL 标记后，重复命令只返回 `RECEIPT_PURGED`，审计读取只保留回执身份和序列。旧明文回执阻断 Purge，必须先完成既有分批密封迁移。此策略会同时撤销该 Workspace 中与目标节点无关的旧回执正文；新 Purge 命令回执不在旧密钥清单内。未密封或不归属目标 Node 的 Run、异常 trace、资源与备份边界继续受保护。

仅当待删消息的附件资源无保留 Message/Manifest/Context/Run 引用、所有版本已密封、附件/Resource/FileChunk 正文已密封且已知原明文文件不存在时，Purge 才在同一事务移除附件与派生块、脱敏资源及 Graph、写入 ResourceVersion 墓碑覆盖层，并将四类旧密钥加入持久 checkpoint；提交后逐项幂等撤钥。直接指向这些附件或文件块的 file/chunk ContextItem 也须无其他节点/Manifest 引用，随事务移除并登记其密钥；任何待移除 ContextItem 若尚无密文引用，整个 Purge 在提交前以 `PURGE_CONTEXT_MIGRATION_REQUIRED` 拒绝。待删旧 Manifest 只有在附件与冻结资源引用全部属于同一待撤销资源集合、且 Manifest 正文已密封时才可一并撤钥；旧明文 Manifest 以 `PURGE_MANIFEST_MIGRATION_REQUIRED` 拒绝。撤钥中断时数据库仍只暴露墓碑，恢复器继续处理。无法归属到独占附件的 Manifest/Context 资源引用仍返回 `PURGE_HAS_RESOURCE_HISTORY`，不可把拒绝保护视为完整资源擦除。

Purge 事务还会清空被删 Node/Message 在所有已保存 Graph projection namespace 中的 title、summary、metadata，并清空其关系标签；同事务清理对应 Context candidate index 行。Graph 查询随后按当前状态重新物化 active namespace。旧 projection version 不能作为可保留的正文副本；此处理不替代其他资源/备份边界的剩余 Purge 工作。

Bundle 导出通过 `/api/v1/workspaces/:workspaceId/bundle` 读取同一事务中的完整 Workspace、Run、Provenance 与 Journal；Application 构造去除运行环境位置和凭据元数据的 portable DTO，Node adapter 以 ZIP 和 SHA-256 描述符输出冻结内容。去除 endpoint 配置后重新计算 portable inputHash，并用 originInputHash 保留原执行引用；该快照不能直接声明 Exact Replay。Domain 定义 portable Workspace v1 schema；Node 解码器使用本地固定 schema 校验字段、引用闭合、内容摘要与每个 Run 的描述符身份，归档携带的 schema 仅作文档。Journal payload 继续使用现有 envelope schema，逐事件历史一致性恢复仍需实现。空目标导入保留原逻辑身份，既有目标拒绝覆盖；同一已激活 checkpoint 的重复调用幂等。`POST /api/bundle/import` 接收 `application/vnd.rhiza.workspace+zip` 流，经 ImportWorkspaceBundle Command 完成导入；当前仅接受归档中的 owner 身份，不执行跨用户身份映射。`Idempotency-Key` 用于重试，归档保存在独立 imports 目录以支持恢复。

当前仓库不是 LibreChat fork。按 V4.2 基线，现有 `server/provider-*` 承担当前 API 配置的 Runtime Adapter 职责；`librechat-data-provider` 提供共享 Model Spec 与文件策略，Rhiza 的 Project、Node、Edge、Context 与 State 语义保持独立。后续迁移仍应扩展 Runtime 能力，而不是让 LibreChat Conversation/Mongo schema 进入 Rhiza Domain。旧映射仅见 `docs/archive/librechat-migration.md`，不定义当前架构。

`POST /api/bundle/preview` 经 `PreviewWorkspaceBundle` Command 复用导入校验并检查归档 owner，返回名称、逻辑身份、归档摘要及消息/Run/资源版本数量。预检只使用临时 staging，结束后清理，不保留归档、不创建业务回执、Journal、checkpoint 或目标 Workspace。UI 先展示预检摘要，再由用户确认导入；正式导入重新校验并在事务中检查目标冲突。预检不是目标可激活的承诺。

## 2. Tech Stack

加密内容的事务写入在工作区锁之前获取 `rhiza:content-lifecycle` 共享事务锁；全历史密钥对账获取同名独占事务锁，并使用锁所属连接读取 SQL 引用，避免跨连接读到不一致状态。独占锁等待上限为 5 秒。此协议覆盖 Repository 事务路径，不授权根据返回的快照直接删除密钥；实际回收仍需在保护范围内重验，并遵守停服维护与外部写入边界。

`reclaimHistoricalKeys` 是停服维护专用 Repository 操作：获取运行时独占权、内容独占事务锁和全部引用表的 SHARE 锁，在同一连接读取所有工作区引用。全部类别的已引用密钥元数据健康后才开始撤销未引用 active key；永久保留空 tombstone，失败后的重复执行跳过已撤销项。文件撤销不随 SQL 回滚恢复。内容目录必须仅属于当前数据库，调用前须停止所有目录使用者（包括直接文件发布者）；数据库锁无法保护其他数据库或进程直接访问同一目录。真实 PostgreSQL 并发行为尚待验收，此操作不等同于对象 Purge。

`pnpm run m09:keys:audit` 对全部 Workspace 的历史正文与 ResourceVersion Blob 密钥做只读引用审计，并流式认证、核对每个仍可用 ResourceVersion 密文的摘要与大小；`RHIZA_OFFLINE_KEY_RECONCILIATION=1 pnpm run m09:keys:reclaim` 仅用于停服后、数据库及上传目录独占的维护窗口。资源引用会核验 scoped blobRef 中的 Workspace/ResourceVersion 身份、摘要及大小；任何已引用密钥缺失或失效都阻止撤销。回收在独占内容锁及 ResourceVersion 表锁下重新读全库引用，先撤销孤儿密钥，再另行按完整保留集合清理不可读密文；当前尚无自动加密 Blob GC。普通业务请求不得调用此维护入口。

M09 Gate 另运行 `m09:plaintext:audit`：停服取得 runtime ownership 后，用单条数据库快照查询计数所有历史正文族、未密封 ResourceVersion Blob 与旧版 Purge 审计自由文本；再逐条解密仍可读的已提交回执，发现嵌套旧 Purge 审计说明同样阻断。两次读取不是同一事务，须保证无直接数据库/密钥写入者；只输出计数，不输出正文。该审计不能替代旧明文 Blob 文件、WAL/备份或已导出 Bundle 的保留期检查。

`m09:provenance:audit` 停服并使用对应 `RHIZA_UPLOAD_DIR`：分别计数全库 Assistant 输出的来源覆盖、解密 Run 输入核对有序引用，并实际读取 recorded Manifest 的 scoped Blob 验证冻结内容；只输出计数，异常即阻断 Gate。多次读取不是同一事务，其他数据库/Blob 写入者须停用。它不替代 Replay 四分类或外部 staging 验收。

`m09:files:audit` 需停服并显式指向同一部署的 `DATABASE_URL` 与 `RHIZA_UPLOAD_DIR`：在持有运行时及内容生命周期锁时，只读核对现存 ResourceVersion 逻辑 digest、旧附件存储键、导入 checkpoint 摘要所对应的原明文路径，以及遗留导入工作目录；任何副本非零即阻断 Gate。停服维护命令 `RHIZA_OFFLINE_FILE_RECLAMATION=1 pnpm run m09:files:reclaim` 只移除有数据库来源的旧 ResourceVersion/附件原文件：全库锁定引用，每批读回所有仍可用版本的 scoped 密文；已标记 `purged-v1` 的版本不再要求可读密钥，但旧附件不得引用它。原文件的类型、大小、摘要及 inode 均须校验后才 unlink；失败可重跑。归档旧 ZIP 仍使用既有 `bundle:reclaim-imports` 完整校验/密封/保留期流程。上述操作均不扫描任意无引用文件、WAL、备份或用户已导出的 Bundle，不能单凭回收命令宣称完整擦除。

ResourceVersion 清除后仍保留不可变 ID、摘要和大小；读取层以已提交 Purge checkpoint 覆盖原始 sealed 引用，返回 `blobRef: "purged-v1"` 与 `purgedAt`。Bundle v1 的该版本不携带 Blob 条目，clean-store 导入只恢复墓碑身份而不重新发布字节。迁移 0033 允许导入端保存这种墓碑，同时禁止墓碑引用与正常可读引用混用。当前仅支持上述独占已密封附件、其可归属的 file/chunk ContextItem 与引用同一资源集合的已密封 Manifest；无法归属的复杂资源历史、旧明文/跨节点 Run、备份和外部导出边界仍受拒绝或独立保留保护。

Node 启动组合根在 Purge 恢复前创建唯一的 ResourceVersion 加密 Blob 适配器，并把它同时交给 Repository 恢复器与 HTTP Host；`resource-version` checkpoint 引用以 Workspace/版本/摘要/大小验证后幂等撤销对应密钥。缺失适配器会使该 checkpoint 保持 pending，启动拒绝对外服务。此接线不放宽上述资源历史 Purge 保护。

迁移 0033 允许 `resource`、`attachment`、`file-chunk` checkpoint 引用；恢复器按 Workspace 与实体身份幂等撤销这些正文密钥，缺少对应存储时保持 pending。Application 仅允许已密封且无共享引用的消息附件资源及其直接 file/chunk Context 来源进入这一事务；其余资源历史仍失败关闭。

迁移 0036 将目标 Node（含其临时支线）的终态密封 Run 纳入 Purge checkpoint：同一事务登记输入密钥、将 Run SQL 输入与错误详情改成最小脱敏事实，并允许删除对应已密封 Manifest v1；提交后 Run 读取与 Replay 失败关闭，Bundle 省略该 Run，密钥撤销可中断恢复。旧明文或非终态 Run、含额外字段的 trace、跨节点 Run/谱系引用、未密封 Manifest 和未覆盖的资源历史仍阻断 Purge。原始 Run 的 ID、状态、输入摘要与最小创建事实保留在 SQL；WAL/备份与外部导出仍按独立保留边界处理。

Run 错误只持久化稳定 code/class 与固定描述，不保存 Provider 原始错误文本；Bundle DTO 同样归一错误码并替换错误描述。全库历史明文审计另外计数非白名单 `record.error`；停服独占的 `m09:run-errors:sanitize` 分批将旧自由文本和扩展字段替换为固定脱敏事实。此操作不会清除已存在的 WAL/备份副本。

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
- `POST /api/graph/nodes/:id/purge`：仅接受 archived leaf、精确 `PURGE <id>` 确认和非空确认说明；说明原文不持久化，审计仅保留已提供标记。终态密封 Run 可随节点清除；旧明文、活跃或跨节点历史引用仍拒绝
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

M10 Purge recovery also reclaims superseded document keys before acknowledging its checkpoint, under the same exclusive lifecycle transaction and all-Workspace reference snapshot. Fresh document directories bind actual database/schema/OID (PGlite: absolute database path) with `.database-owner`; unknown legacy directories are never adopted or reclaimed online. They require the existing explicit offline key reconciliation. Read-only M10 inspection reports pending checkpoints and never creates this marker. ResourceVersion Blob and import archive revocation stay scoped. Archived graph nodes expose an explicit-confirmation Purge dialog; narrow screens expose Bundle controls through the Workspace menu and keep the composer above the bottom navigation.

## M11–M14 Chat and graph convergence

Warm production graph reads use `BoundedGraphQueries` against the active projection namespace, with Workspace locks and SQL limits. Ordinary Application commands compute before/after graph facts and commit only changed objects/relations, the projection checkpoint and the Command receipt in the same transaction. Explicit initialization/rebuild remains a dedicated full projection operation. Graph responses expose the actual namespace version; cursors bind scope, version, checkpoint and filters. Changes without retained object revisions request a bounded reset. Conversation, Segment and immutable Message objects have derived containment edges and layouts; child lifecycle follows archived sources. No prompt decryption is needed to project Run metadata.

Stop uses a stable per-attempt idempotency key and a scoped command-to-Run lookup when RUN_CREATED has not arrived. Aborting transport is followed by persisted cancellation. Reconnection queries state and never resends a generation. Temporary SSE uses the same execution/audit lifecycle, ends with TEMP_RESULT, and creates no permanent Conversation or Message. Server Retry reconstructs a failed/canceled/interrupted Run's frozen request parameters, preserves parentRunRef, and prepares a new Manifest using current Context/model selection. The model priority is Conversation preferredModelId, Workspace defaultModelId, then the existing global default; an unavailable explicit preference fails closed. Migration 0037 adds optional metadata and scoped lookup indexes without changing existing immutable payloads.

Segment ranges validate offsets and selected text against the original Message ID, create an Anchor, and retain that identity across later message versions. Removing a Segment archives it and excludes it from future candidate selection; frozen historical Manifests remain readable. Workspace lexical search reuses the scoped candidate index with literal case-insensitive substring matching and title-first ordering. Merge requires an explicit same-Workspace target and uses the latest assistant reply's full text unless the user confirms a summary.

Graph UI caches at most 1000 objects/4000 relations, separates Workspace/version/checkpoint/root/filter identities, and mounts only cards whose rectangles intersect the measured viewport. Zoom <=0.85 displays Conversations; closer zoom lazily requests the selected Conversation's Segment/Message neighborhood. Layout and selection remain presentation/projection state; Context actions affect subsequent Manifest preparation. Purged tombstones are read-only. Existing React, SQL, candidate index, runtime and persistence capabilities are reused; no new production dependency is introduced.
