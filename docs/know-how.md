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
- Provider 调用必须只发生在服务端；浏览器不得读取 API Key 或直接调用第三方模型。
- 一次成功 Chat 写入必须同时包含用户消息、AI 消息与 Context Manifest，避免审计记录和消息历史分离。
- ResourceVersion 是 append-only 历史事实：同一 Resource 的新内容只能新增版本，不得修改或删除旧版本；FileChunk 只能登记为 materialization，不能替代原始 ResourceVersion。
- Blob 提交顺序固定为 temp write → SHA-256 verify → atomic promote → Workspace/DB commit。DB 失败后保留已 promote blob 给 grace-period GC，不能先提交引用再补文件。
- orphan GC 只能在调用方提供覆盖整个 BlobStore 的完整 active-reference set 后执行；不得用当前用户或单个 Workspace 的局部引用集合扫描全局 store。
- versioned blob 读取失败或 digest 不匹配必须返回稳定 `BLOB_INTEGRITY_ERROR`，不能静默回退旧 UUID 附件。旧路径只服务尚未回填的 legacy attachment；运行 `pnpm run resources:backfill` 后 dangling 必须为 0 且重复运行 checksum 一致。
- M04 的 HostRuntimePort 只包含当前 Chat 所需 file/path/blob/credential seam。spawn/PTY/process supervision 属于 M24，Desktop 与真实跨平台 host matrix 属于 M29；不要为这些延后能力在 M04 建兼容层或 fake matrix。
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
