# Project Know-How

## 1. Common Problems

- Rhiza 的对象层级较多，若直接把所有功能平铺在首屏，会违背“默认简单、渐进暴露”的产品原则。
- Node 是语义讨论单元，不是单条消息；Graph 不应按消息数量增长。

## 2. Proven Solutions

- 默认保留 Chat 聚焦区，把 Context Inspector 放在邻接面板，Graph 与 Project State 放在同级主视图。
- 使用 Active、Recommended、Excluded 三段表达 Context 生命周期，用角色标签表达语义地位。
- 将视觉语言收敛到 `app/static/css/tokens.css`，以降低后续风格改版成本。
- 品牌使用中文主名“根系”和英文标识“Rhiza”；旧的 RabbitHole 仅可作为历史数据 ID 保留，不再出现在用户可见界面、日志或系统提示词中。
- LibreChat 只能实现 `AIRuntime` 边界。迁移 UI 时复用交互能力，不复用 LibreChat Conversation/Mongo 领域结构。
- LibreChat `BaseClient.sendMessage` 与客户端 SSE handler 可作为 Runtime Event 映射来源；Rhiza 应消费稳定事件协议，不直接调用 controller 或数据库保存函数。
- 浏览器流式请求使用 POST + `fetch().body` 读取 SSE，因为生成请求需要携带冻结前的用户输入；不要用只能 GET 的原生 `EventSource` 反向改变 API 语义。
- LibreChat 的低耦合共享能力优先从精确锁定的 `librechat-data-provider` 引入；Model Spec 和文件策略可直接复用，领域 Prompt 只对齐其角色化消息顺序。

## 3. Development Notes

- 领域状态由 `App` 统一持有，表现组件通过回调修改，避免 Context 数量和预算显示不一致。
- `AppShell` 只组合 Sidebar、Workspace surface、Context 与 overlay；API 调用、持久化 mutation、streaming 和 reconciliation 必须留在 `App` coordinator/application 边界。
- Graph 前端通过 `graph-model.ts` 的 UI-facing model 消费数据。M07 bounded API 已作为适配器输入，但 projector cursor、projection table schema、Journal sequence 与 hover/zoom/panel 等 UI-only 状态不得进入 `GraphView` 契约或 Domain relation。
- Graph 列表分页必须保留跨页关系，并在展示前筛选已加载的端点。分页 cursor 绑定 checkpoint；失效后刷新第一页，不混合两次投影。Workspace 切换要同时清空 Graph DTO 和作废在途页。
- Graph Projection 的 active namespace、checkpoint 与 semantic checksum 必须在同一事务更新。正常 checkpoint 推进复用 active namespace；clean rebuild 写新 namespace，只有完整写入后才能切换 alias，且旧 namespace 保留给回滚。
- `ObjectRef.objectType` 与 relation catalog 是开放字符串集合；新增 object family 不应修改 projection schema enum。Graph 查询必须在服务端执行 depth <= 3、objects <= 500、relations <= 2000 的硬限制，不能只靠前端截断。
- 投影输入、Run 状态和 Journal head 需在 Workspace 写锁内读取并与 checkpoint 原子提交；不能先读 Current State 再从另一个事务取 Journal head。重建应读取完整删除历史，不能复用 activity feed 的 10,000 条上限。
- Layout 是用户拥有的 projection 输入，写入 `graph_layout_nodes`；不得把 x/y 当作对象语义 checksum 的独立真相，也不得让 rebuild 丢失布局。
- Provider 调用必须只发生在服务端；浏览器不得读取 API Key 或直接调用第三方模型。
- 一次成功 Chat 写入必须同时包含用户消息、AI 消息与 Context Manifest，避免审计记录和消息历史分离。
- Context Compiler 的 JSON snapshot 保存精确文本（包括空字符串），Blob 必须先校验再随 Run 创建登记 ResourceVersion。历史查询只沿 Manifest 冻结引用读取；不能用当前索引或来源内容填补缺失证据。Manifest v1 的 DELETE 不受 legacy purge 开关豁免。
- ResourceVersion 是 append-only 历史事实：同一 Resource 的新内容只能新增版本，不得修改或删除旧版本；FileChunk 只能登记为 materialization，不能替代原始 ResourceVersion。
- Blob 提交顺序固定为 temp write → SHA-256 verify → atomic promote → Workspace/DB commit。DB 失败后保留已 promote blob 给 grace-period GC，不能先提交引用再补文件。
- Scoped ResourceVersion Blob 的密钥身份必须绑定 plaintext digest。同一 `{workspaceId, resourceVersionId}` 的中断重试只可复用相同 digest；不同 digest 必须报 identity conflict，已生效密钥不得因失败重试而撤销。历史 `sha256` 迁移必须先读回 scoped 密文并核对 digest/size，再更新不可变引用；在全库引用和归档 pin 未对账前不得删除明文对象。
- Bundle 导入的目标端 Blob 重绑不止更新 Workspace 的 ResourceVersion/Attachment：终态 Run 的冻结附件也含 `blobRef`。先校验其身份与版本，再替换为目标 `sealed-v1` 引用并重算当前 `inputHash`；`originInputHash` 保留原执行证据，否则导入后附件 Replay 会因引用不一致失败。
- Bundle 恢复用归档与 Resource Blob 分目录、分密钥；checkpoint 的七天恢复窗口按最新 updated_at 计算，同 digest 任一有效 checkpoint 都是 pin。清理时先撤销归档密钥，再删除描述符并按完整保留集合做 ciphertext GC。旧明文归档要先完整校验、加密并从密文读回通过后才能删除；导入/导出临时明文只放在项目私有 imports/transient，重启后持有运行时独占权才清理。运行清理前须独占服务，避免在途 retain 尚未发布描述符时误撤销密钥。
- orphan GC 只能在调用方提供覆盖整个 BlobStore 的完整 active-reference set 后执行；不得用当前用户或单个 Workspace 的局部引用集合扫描全局 store。
- versioned blob 读取失败或 digest 不匹配必须返回稳定 `BLOB_INTEGRITY_ERROR`，不能静默回退旧 UUID 附件。旧路径只服务尚未回填的 legacy attachment；运行 `pnpm run resources:backfill` 后 dangling 必须为 0 且重复运行 checksum 一致。
- M04 的 HostRuntimePort 只包含当前 Chat 所需 file/path/blob/credential seam。spawn/PTY/process supervision 属于 M24，Desktop 与真实跨平台 host matrix 属于 M29；不要为这些延后能力在 M04 建兼容层或 fake matrix。
- 对生产 relational adapter，M05 的 `WorkspaceUnitOfWork` 是 State + Event + Receipt 唯一事务 seam。命令处理器只提供 mutation；adapter 负责 command lock、receipt lookup、sequence reservation、Journal append、shadow checksum 与 commit。不得把这些步骤散落到 HTTP 或各个 command handler。JSON repository 的无 Journal 更新路径只允许测试 fixture 与显式 legacy import 使用，不得接入生产 composition root。
- Domain Journal 只记录 ADR-005 的低频语义事实。token、SSE chunk、stdout/stderr、file-read、heartbeat 与 telemetry 不得进入 `workspace_events`；M25 之前不得创建 `workflow.*` catalog。
- Semantic reconcile 按稳定 ID 规范化顶层实体集合并按 key 规范化对象，不能依赖 SQL 返回顺序或 JSON 属性顺序；嵌套有序值保持顺序敏感，业务字段变化仍必须产生 checksum drift。
- 历史 Workspace 回填写 `workspace.baseline.backfilled`、内联 versioned semantic snapshot 与 checksum，不伪造过去的细粒度行为。固定 command id `backfill:workspace-baseline:v1` 保证脚本可中断、可重跑；新建 Workspace 的 `workspace.created` 自带初始 snapshot。
- 确定性拒绝须在命令锁内回滚 savepoint 并提交 rejected receipt；不能先释放锁再用新事务补 receipt，否则并发同 id 重试可能先提交不同结果。生命周期命令与内容命令遵守同一 Workspace 锁顺序。
- Backfill 必须发生在业务 tail 之前；如果已有 event 却没有 sequence-1 baseline，应以 `JOURNAL_BASELINE_ORDER_CONFLICT` 停止并从启用前备份恢复，不能移动或改写既有 sequence。
- 默认 Workspace 启动时幂等运行 Journal baseline backfill，保证全新库首次 Bundle 导出可用；中途退出重启可续跑。已有非法 tail 仍应 fail-closed，而非在导出查询中临时伪造 baseline。
- 无 `DATABASE_URL` 时默认使用 embedded PGlite；JSON WorkspaceStore 只作为 fixture/importer。旧 JSON 数据必须通过 `pnpm run workspace:import-json` 显式导入，再运行/确认 Journal baseline。
- 可选的 `RHIZA_PROJECT_ID` 将空字符串和纯空格视为未配置，非空值必须是 UUID；`.env.example` 中的可选持久化配置保持注释状态，确保复制后直接使用 embedded PGlite。开发环境修改 `API_PORT` 时，Vite `/api` 代理必须读取同一配置。
- Workspace 更新通过串行队列与临时文件替换，避免多个请求交错造成 JSON 部分写入。
- M03 的 HTTP identity 是确定性 local actor seam，不是认证实现；旧 `/api/*` 只能映射到 configured default Workspace，scoped 路径的 ScopeRef 必须从 `/api/v1/workspaces/:workspaceId` 派生，不能信任 body 中的 workspace id。
- 已存在但不属于 local actor 的 configured default Workspace 不得被 bootstrap 自动授予 membership；只有缺失的 default Workspace 才可按 local owner 初始化。
- Workspace 切换必须先清空旧 scope 数据，并以 request generation 丢弃乱序响应；失败时宁可显示空状态和错误，也不能短暂回显上一个 Workspace。
- API Key 使用随机本机密钥进行 AES-256-GCM 加密；安全响应只返回 `hasApiKey`，永不返回密文或明文。
- Chat 运行时必须从持久化的 `activeModelId` 解析供应商，Manifest 保存真实 Provider model ID。
- 模型选择必须在生成前冻结为 Runtime `modelId`；不要在请求执行中途再次读取可变的 `activeModelId`。
- 流式生成期间只维护前端临时 Assistant Message；服务端必须等 `RUN_END` 后再原子提交 User Message、Assistant Message 与 Manifest，`RUN_ERROR` 时三者都不写入。
- 模型执行只读取现有 Provider Catalog/API Key；不要再引入第二套 LibreChat URL/Token 配置覆盖当前模型选择。
- `@librechat/agents@3.2.46` 要求 Node.js 24，当前 Node.js 22 环境不要强行安装；升级运行环境并评估其 LangChain/tool 依赖后再接入完整 Agent/MCP。
- Message 必须带 `nodeId`；Provider 历史只读取活动节点，避免支线探索污染主线对话。
- 正式支线创建应原子写入 Node 与 `derived-from` Edge，并保存 `sourceMessageId`/`anchorText`；合并不复制完整历史，只写摘要引用和 `merged-into` Edge。
- Graph 交互使用世界坐标与视口变换：Pointer Events 统一节点/画布鼠标与触控，节点拖动期间本地更新坐标，Pointer Up 后调用位置 API，失败时由 App 回滚；缩放围绕指针位置修正平移，避免画布跳动。
- 图谱编辑通过 `/api/graph/nodes` 和 `/api/graph/edges` 持久化；删除节点必须阻止仍有子支线的节点，删除关系先选中关系再执行删除，避免误操作。
- 临时支线必须保持“两阶段提交”：`/api/temp-chat` 只返回结果，点击保留后 `/api/nodes` 才迁移消息并创建正式关系。不要为了临时 AI 调用提前生成持久节点。
- 节点层级由 `sourceNodeId` 动态计算；超过三层后停止增加视觉缩进，用 L-level 标签、压缩面包屑和“聚焦当前路径”降低方向迷失。
- AI 输出统一经过 `MarkdownContent`，不要在 ChatView 内直接拼接 `dangerouslySetInnerHTML`；Mermaid 只允许通过 Mermaid 自身的 strict 安全模式渲染。

## 4. Testing Notes

- 测试推荐上下文时，应通过按钮的可访问名称定位，避免依赖装饰性 DOM。
- Provider 测试注入 mock `fetch`，验证 Authorization、模型、Active Context Prompt 和响应解析，不进行真实付费调用。
- 流式测试同时覆盖 SSE 多片段拼接、最终 Commit 事件和中途 `RUN_ERROR` 不落盘，避免只验证完整 JSON 回退路径。
- API 集成测试使用临时目录，验证磁盘持久化并在测试结束后清理。
- macOS 上 Node 的默认 `listen(0)` 可能只监听 IPv6，而 Supertest 对 server 对象固定请求 `127.0.0.1`；IPv4 同端口可被其他服务占用并偶发返回无关 401。E2E 测试服务须显式监听 `127.0.0.1` 并在 teardown 关闭。
- 安全测试必须证明 Provider JSON 和 HTTP 响应都不含测试用明文 Key。
- 支线集成测试要覆盖创建、坐标持久化、合并状态、活动节点回切和语义边写入。
- Graph 回归测试要覆盖画布缩放、节点/关系创建与删除，以及删除节点后的边和消息级联清理。
- 临时支线测试必须比较调用前后的 Workspace 文件，证明 AI 请求没有隐式持久化；保留测试需要验证所有临时消息被重新分配到新节点。
- Markdown 回归用例应覆盖语法解析和渲染容器，而不是只断言原始字符串存在；Mermaid 测试可 mock 动态模块，避免测试依赖浏览器布局。

## 5. UI/UX Notes

- 浅色块区分语义状态，微圆角和低强度阴影区分交互层级。
- 青绿点阵只用于品牌、AI 身份和“思考中”状态，避免发光效果泛滥。
- 小于 1120px 时 Context Inspector 必须转为可关闭抽屉；小于 760px 时导航转为底部栏。
- 字体通过 `@fontsource` 本地打包，避免本地部署时因外部字体服务超时产生控制台错误和视觉跳变。
- 桌面端临时对话采用同一 Chat Workspace 内的 sidecar，不出现在 Sidebar；窄屏下转为底部浮层，仍保持主讨论可返回。
- 固定 Context 右栏在高密度 Graph 场景仍会占用明显横向空间；`AppShell` 已把 Context 作为独立 surface，未来 Drawer、Tray 或 Bottom Panel 的产品选择留给 M18，并应依据 M12–M17 的真实使用数据决定。

## 6. Debugging Notes

- 若 Context 计数不更新，先检查条目的 `status` 是否由顶层 `updateStatus` 更新。
- 若窄屏面板不可见，检查 `.context-open` 是否添加在 `.app-shell`。
- 若发送按钮禁用，先访问 `/api/health` 检查 `provider.configured`；无鉴权的本地端点必须显式设置 `AI_ALLOW_NO_KEY=true`。
- 网页新增本地 Ollama 时可勾选“允许无密钥连接”；远程 HTTP 服务不得使用该选项。
- 若模型同步失败但 Chat Completions 可用，手动填写模型 ID 即可，不要把 `/models` 可用性当成聊天能力的必要条件。
- 第三方 401/404 通常分别表示 Key 无效或 `AI_BASE_URL` 已包含/缺少错误的版本路径。
- 移动端底栏从 `.side-section:not(.threads)` 提取视图导航；不要依赖 `:first-of-type`，因为同级品牌元素同样是 `div`。

## 7. Do Not Do

- 不要在 Graph 中默认展开 Message 级节点。
- 不要把支线消息并入全局 Provider history；讨论流展示与请求历史都必须按 `nodeId` 过滤。
- 不要把临时支线展示成正式节点、计入讨论流数量或写入图谱；只有“保留”动作可以改变这些持久状态。
- 不要无限增加树形缩进；深层级必须压缩视觉深度并保留可点击的祖先路径。
- 不要把 AI 推荐直接等同于已生效 Context 或 Project State。
- 不要把 API Key 放入前端环境变量、React 状态、日志或 Workspace JSON。
- 不要从安全 API 回显加密后的 Key；密文同样不应暴露给浏览器。
- 不要在 Provider 失败时写入伪造 Assistant Message；应把明确错误返回用户并允许重试。
- 不要在组件内硬编码新主题色；先扩展语义设计令牌。
- 不要用高强度大圆角、紫色渐变和大面积发光替代清晰的信息层级。
- 不要因为当前仓库存在 OpenAI-compatible Provider 就宣称已经完成 LibreChat Runtime 迁移；必须以锁定 upstream commit、许可证清理、接口适配和回归测试为准。
- 不要让 Runtime 负责 Rhiza Message、Node、Edge 或 Manifest 持久化；Runtime 只发事件，Product API 决定何时原子提交领域状态。
- 不要复制 LibreChat 的 MIME 列表、Model Spec schema 或 endpoint 常量；统一从锁定版本的 `librechat-data-provider` 读取。

## 8. Git/网络注意事项

- 本机 Clash 当前 HTTP 代理端口为 `127.0.0.1:9095`；Git 全局 `http.proxy` 与 `https.proxy` 必须和该端口一致，否则 Smart HTTP 会继续尝试失效的旧端口。
- GitHub 连通性应使用 `git ls-remote` 验证，而不是只看浏览器或 `curl`；该命令能覆盖 Git 实际使用的 Smart HTTP 路径。
- 当前仓库的 `upstream` 指向 LibreChat 官方仓库，用于锁定 Runtime 参考版本；Rhiza 自有 `origin` 需要明确的仓库地址后再配置，不能用 upstream 代替。

## 9. Chat Run persistence

- 创建 Run 必须早于任何模型调用；成功终态必须与消息/Manifest 同事务。不能先写 completed，再另行提交消息。
- 取消先持久化终态再 abort；成功提交与取消的胜者由数据库 guarded update 决定。不可依赖 Provider 一定遵守 AbortSignal。
- Retry/Regenerate 使用新 Run + parentRunRef。相同 command id 只用于幂等重放，不能用它发起新的外部调用。
- 临时 Chat 不写正式消息/节点，但保留执行输入与终态。不得为了沿用“临时不落盘”概念绕过执行审计。
- PostgreSQL 启动恢复必须在取得 runtime ownership 且尚未接受请求时运行，不能在在线查询中扫全库并中断其他活跃请求。
- Run trace 只能保存已知事件类型与 `sequence/type/at`，存储适配器须重新投影输入而非直接 JSON 序列化调用方对象；`m09:traces:audit` 扫描全库历史行，缺表或异常字段必须阻断 Gate，不能视为零异常。旧行的额外字段可在停服独占窗口用 `m09:traces:sanitize` 分批移除；核心字段无效时不得猜补，需人工核实。
- 有 Run 关联或输入引用的节点不能仅删除原节点后宣称物理清除；Purge 以 `PURGE_HAS_EXECUTION_HISTORY` 拒绝，使用 Archive 保留可解释历史。跨节点 Run 也可能通过 `sourceMessageId`、Manifest、history 或 Context `sourceId` 引用待删内容；须检查旧明文与密封输入，不能只比对 Run 节点 ID。
- `run-input` 密钥可从持久 Purge checkpoint 幂等撤销，但只有恢复器能力，Application 尚不登记真实 Run 引用；不能因此解除执行历史拒绝保护。缺失 Run 内容适配器时 checkpoint 必须维持 pending。
- ResourceVersion Blob 密钥对账必须读取全部 Workspace 的版本引用，并校验 `sealed-v1` 的 Workspace/版本身份、digest 与 size；只读审计不授权回收。停服回收须同时独占数据库和上传目录，先对历史正文与资源密钥全量预检，再分别在锁内重读引用并撤销孤儿密钥；缺失的已引用密钥应阻断，不能误清理其他 Workspace 的同摘要内容。
- Purge 的 SQL 删除、redacted provenance、审计事实与待撤销 scoped key 清单必须同事务提交；提交后 key destroy 可中断且不可回滚，因此逐项 acknowledgement 与 checkpoint 必须允许重复撤销。启动取得 runtime ownership 后先分批排空 pending checkpoint，再读 Workspace、回填 Journal 或开放 HTTP；某一批无法推进则拒绝启动，不能只记录警告。执行历史保护只能在 Run、Journal、receipt/trace 等每一份正文副本均进入该流程后移除。
- Purge 的自由文本确认说明可能包含待清除秘密；Application 只将固定 `provided-redacted` 标记写入 AuditEvent，共享 Workspace 历史校验还限制审计 metadata 的字段与计数，拒绝其他写入者夹带正文。旧审计行的自由文本仍须单独迁移/审查，不能据新写入行为宣称历史副本已清除。
- Journal Purge 不更新 append-only 事件行；在同一事务发布脱敏 baseline/tail 覆盖层并登记原有效载荷密钥，所有历史读取与密钥对账只认覆盖层。无已加密且可重放的 baseline 时拒绝 Purge；仅删除 Current State 会让旧 Journal snapshot 泄露正文。
- Purge 的幂等回执读取也属于历史正文边界：同事务标记旧密文回执不可读并登记 result/error 密钥，重试旧 command id 必须返回 `RECEIPT_PURGED` 而非重放旧结果；旧明文回执先迁移，否则拒绝 Purge。
- 任意阶段的导入 checkpoint 都可能有加密恢复 ZIP 持有现有 Workspace 的旧正文。先写身份 checkpoint，再在 Workspace/内容生命周期锁下保留 ZIP；Purge 必须在同事务登记所有关联摘要，提交后逐项幂等撤销密钥。Purge 后的新导入或旧 checkpoint 重试要在保留前拒绝；已 Purge 的摘要不能再作为恢复窗口 pin。旧明文 ZIP 必须先迁移并清除，否则 Purge 提交前失败。描述符发布失败须撤销未发布密钥，进程死于发布前的孤儿 key 在启动 reclaim 时撤销；不能凭 phase 或 `updated_at` 推断已擦除。
- 同一恢复 ZIP 摘要可被不同 Workspace 的 checkpoint 引用。导入 begin/retain 与 Purge 收集引用须按 Workspace→摘要顺序取事务级锁；否则另一 Workspace 未提交的 checkpoint 对 Purge 查询不可见，Purge 会误撤销共享归档密钥。待撤销 checkpoint 阻断同摘要新导入；撤销完成后先清理旧密钥的描述符，再允许相同 ZIP 重新导入并获得新密钥。
- M09 不能仅凭密钥引用健康宣称历史迁移完成；Gate 还须对全库历史正文列、嵌套 Context/FileChunk 与 ResourceVersion Blob 引用做同一时点的明文计数审计，并分别核对旧文件和备份保留边界。
- 旧 Purge 自由文本说明可能嵌在后续命令的密封回执内，即使 `rhiza_audit_events` 已无明文。`m09:plaintext:audit` 停服独占后解密扫描所有仍可读的已提交回执，只输出异常回执数；密钥缺失/读取失败必须阻断，而不能当作零泄漏。SQL 计数与回执扫描不是同一事务，其他直接写入者须停用。
- Provenance 回填成功数不等于全库覆盖率；`m09:provenance:audit` 要扫描所有仍存在的 Assistant 输出，并区分缺失、broken-reference 与无效/悬空记录，不能把 pre-run 当成缺失。recorded 关系的直接回复输入、Manifest、Run、model、endpoint 和 runtime snapshot 必须与持久事实对账；所有非 purged 输入引用还须在同一 Workspace 可解析，revision/branch 来源要匹配持久 Message/Node。只检查直接回复会漏报额外的悬空输入；深度审计须解密并验证冻结 Run 输入哈希，核对完整有序输入引用集合，再从对应上传目录读取所有 recorded Manifest 的冻结 Blob。各阶段不是同一 SQL 事务，Gate 应停服并取得独占 runtime ownership，禁用其他数据库/Blob 写入者，且不输出正文。
- `m09:files:audit` 只能在停服且 `RHIZA_UPLOAD_DIR` 指向被测数据库的实际上传目录时运行；它通过历史逻辑 digest/key/checkpoint 检查已知原明文路径，零结果不代表任意孤儿文件、WAL 或备份已过期，更不授权删除。
- 旧原始 ResourceVersion Blob/附件文件不能与 SQL 引用更新同事务删除：先分批密封并读回，再在停服独占窗口运行 `m09:files:reclaim`，逐批验证仍可用版本的 scoped 密文及原文件摘要/身份后精确 unlink；数据库已标记 `purged-v1` 且带 `purgedAt` 的版本无可读替代密文，但旧附件（包括 `sha256/...` storage key）不能以该墓碑充当替代。旧文件的每层父目录都必须是真实目录，不能透过 symlink 越出上传根目录。重复运行安全。该命令不处理归档、无引用孤儿、WAL、备份或外部 Bundle，也不代替备份保留策略。
- 旧消息的 `attachmentIds`、待删旧 Manifest 的附件或冻结资源引用、节点关联的 file/chunk ContextItem 都可能在没有 Run 时指向仍可读的 ResourceVersion；ContextItem 即使标成 `reference` 也可能通过 `sourceId` 指向附件或文件块。独占已密封消息附件可在 Purge 事务中将所有版本转成墓碑、移除附件/派生块，并登记 Resource/Attachment/FileChunk/Blob 密钥；直接指向这些附件/块且无保留引用的 ContextItem 同时删除并撤销密钥。任何被删除的 ContextItem/旧 Manifest 必须在旧项目状态/Manifest 行中有可撤销的密文引用，不能把旧明文字段随 SQL 删除视为 crypto-shred。旧 Manifest 的附件与冻结资源引用只有全部落在已确定的独占资源集合时才可撤销；其他节点/Manifest 的保留引用、无法归属的来源或跨节点 Run 必须先拒绝。Manifest v1 继续受不可变执行历史保护，不能因一个资源族可擦除就解除整体保护。
- Purged ResourceVersion 的可移植表示是保留原 ID/digest/size、置 `blobRef` 为 `purged-v1` 并带 `purgedAt`，Bundle 中不含其 Blob 条目；导入不能为它创建新密钥。来源数据库的不可变版本行保持原引用，通过已提交的 `resource-version` Purge key 清单在读取时覆盖为墓碑；目标空库可直接插入墓碑行。只有完整资源副本撤销接通后才能解除现有资源 Purge 拒绝保护。
- 启动时 Resource Blob 适配器必须先于 Purge checkpoint 恢复构造，并由 Store 与 Host 共用同一上传目录/密钥根；恢复器按 checkpoint 的 Workspace/ResourceVersion 身份校验引用，缺少适配器保持 pending 并阻断启动。重复撤销允许；此能力不授权业务请求直接绕过 `PURGE_HAS_RESOURCE_HISTORY`。
- Graph rebuild 会保留旧 projection namespace，其 Node title/Message summary/关系 label 是独立正文副本。Purge 必须在删除 Current State 的同一事务中脱敏所有历史 namespace 与 Context candidate index，不能只等待下次 Graph 查询重建 active alias。
- 旧 ContextItem 可能仅以 `sourceId` 指向被 Purge 的 Message/Segment/Anchor 而没有 `sourceNodeId`；不能只按来源类型或节点字段清理。Application 移除这些项后，持久化 Purge checkpoint 才能登记其内容密钥撤销。

- Graph layout command 的 `nodeId` 只用于定位节点，写回领域节点时只合入 `x/y`；否则 JSON 中多出的命令字段会与 SQL 重读结果不同，触发事务语义校验回滚。

## Context materialization and history

- Candidate rows and their revision commit with source facts. Graph-edge changes also invalidate planning even when source text is unchanged. Rebuild derived rows with `pnpm run context:rebuild`; a missing or unsupported index must not reuse stale selection text.
- Plan caches use existing source versions/digests; new per-execution frozen ResourceVersions are created after planning. Historical lookup follows those frozen references and never reruns Planner.
- Manifest v1 rejects deletion even under the legacy purge flag. Preserve its referenced ResourceVersions and blobs when implementing retention or cleanup.
