# Rhiza UI/UX 实屏验收

实现位置：`.`，运行页面为 http://127.0.0.1:4173 。已直接访问并操作 http://127.0.0.1:4175/preview.html，沿用其紧凑工作台、分层阅读和柔和语义配色，按生产组件与真实行为调整。此报告覆盖本轮 UI 改造，不代表 M15–M18 的全部里程碑验收。

## 改造与验证

| 页面 | 已落地 | 实际验证 |
| --- | --- | --- |
| 工作台 / 对话 | 单一标题栏、折叠工作区管理、清晰消息阅读区、次要操作与来源详情渐进展开、简化输入工具 | 桌面阅读与菜单；手机无横向溢出；输入 16px；菜单 Escape 与焦点恢复；消息发送/编辑/重试/附件回归 |
| 多模型协作 | 参与者并列、状态与进度、独立合并建议、冻结输入放入详情 | 本地保留的真实协作记录；两栏桌面、一栏窄屏；独立重试、停止与汇总原行为由现有测试验证 |
| 上下文 | 宽屏右栏、平板抽屉、手机底部面板、轻量来源行 | 1366px 右栏；1024px 抽屉；390px 面板；Tab / Shift-Tab 约束、Escape、原位置和焦点恢复 |
| 图谱 / 知识状态 | 可读节点、共享几何尺寸、可展开归档节点、精简视图操作；统一状态卡片排版 | 边缘裁剪回归、保存视图恢复、归档恢复；桌面与手机图谱布局；知识卡片实屏 |
| 执行历史 | 状态徽标、模型与耗时、状态筛选和搜索、可展开输入与身份、历史来源和恢复入口 | 桌面/390px；筛选失败记录、无结果与清除；Enter 展开详情；精确定位记录始终可达；停止、逻辑重试身份与显式回放策略回归 |
| 活动时间线 | 日期分组、事件分类和搜索、可展开完整事件身份、明确已加载数量 | 桌面/390px；分类、对象搜索、无结果与清除；完整详情长 ID 换行；加载/错误恢复和 Journal 顺序回归 |
| 设置 / 数据 | 字号、间距与控件统一 | 打开和关闭已有对话框；设置 Escape 与焦点返回；不提交配置、导入、删除或回放 |

手机验收修复了刷新按钮被旧样式隐藏、筛选字号覆盖、工作区菜单导航后仍遮住内容的问题。选择视图和讨论收起菜单，展开树节点仍留在菜单中。

旧协作合并记录的四个全空数组元数据只在已验证输出的阅读区隐藏；原文仍用于复制、输入和原始记录详情。包含实际内容、未知字段或无法验证的 JSON 全部保留。

## 自动检查

命令从 `package.json` 推导，未修改检查强度或禁用用例。

- 最终前端：`pnpm exec vitest run src --maxWorkers=1 --testTimeout=30000`，23 文件 / 201 项通过，见 [日志](frontend-final.log)。本轮新增历史、活动与手机导航回归先失败后实现通过。
- `pnpm run lint` 通过，见 [日志](lint-final.log)。
- `pnpm run build` 通过，包含 `pnpm run typecheck`、Vite 和服务端构建，见 [日志](build-final.log)。
- 历史/活动追加之前运行 `pnpm test`：118 个单元测试文件 / 587 项通过；31 个 E2E 文件 / 158 项通过、94 项条件跳过，见 [当时完整日志](full-suite-before-history.log)。未配置真实 PostgreSQL 的条件用例没有被算作通过。后续 UI 追加以最终前端、lint、类型检查与构建验证，不把前次完整测试视为最终状态的全量证明。
- `git diff --check` 通过。

验收期间存在另一路 Context Selection 开发与热更新。一次旧热更新的 React effect 依赖长度提示留在浏览器日志；最终重新加载页面后无新增错误。新增确认身份测试最初受到前一测试 mock 调用污染；该 mock 在并行开发方补齐隔离后，最终全部前端测试通过。

## 实际截图

- [多模型协作](11-collaboration-desktop-final.jpg)
- [宽屏上下文](12-context-desktop.jpg)
- [知识状态](13-knowledge-desktop.jpg)
- [执行历史桌面](18-history-desktop-final.jpg) / [手机](19-history-mobile-final.jpg)
- [活动时间线桌面](17-activity-desktop-final.jpg) / [手机展开详情](20-activity-mobile-final.jpg)
- [手机上下文](08-context-mobile.jpg)
- [设置](15-settings-desktop.jpg) / [数据](16-data-desktop.jpg)

截图均来自实际应用。浏览器验证使用现有本地验收记录，没有新发起真实外部模型调用，也没有做完整辅助技术或 WCAG 合规认证。API、持久化、鉴权、迁移与模型协议保持原有边界。

## Provider 固定状态与协作预算补充验收

沿用 ui-ux-design-suite 已批准紧凑方向，对正式 App/ProviderSettings 使用七种固定内存响应：healthy、degraded、invalid-key、loading、empty、error、saved。主桌面1440×900与窄屏390×844均已检查，范围内 visual verdict = PASS。加载、冲突和保存成功从真实组件操作产生；样本不用真实存储、密钥或后端。具体尺寸、状态和截图见 [机器记录](provider-state-evidence.json)。

窄屏发现并修复：后加载的桌面规则覆盖了纵向布局；22px backdrop 与100vw面板导致裁切；全局 ghost-button 隐藏误伤获取模型与目录同步。修复仅限 Provider 的窄屏组合：全屏弹窗、有限高度供应商列表、单列表单、操作换行、长模型名/ID折行。确认面板范围0–390px、目录无横向溢出、保存/获取模型/批量同步可见，收藏/置顶仍可达。见 [修复前](provider-healthy-narrow-before.jpg)、[表单](provider-healthy-narrow.jpg)、[长目录](provider-models-narrow.jpg)、[无效密钥](provider-invalid-key-detail-narrow.jpg)、[空目录](provider-empty-detail-narrow.jpg)、[保存冲突](provider-error-narrow.jpg)、[保存成功](provider-saved-narrow.jpg)。桌面规则未变。

协作仍在当前对话中：选择2模型、第二意见、8k Token/30秒，完成综合意见后纳入原讨论，再发送后续消息。冻结记录和后续Run输入证明预算已保存、截止时间不重置、纳入消息进入后续历史；刷新后内部输出支线不作为侧栏入口。见 [桌面预算](collaboration-budget-controls-desktop.jpg)、[窄屏预算](collaboration-budget-controls-narrow.jpg)、[纳入结果](collaboration-budget-retained-narrow.jpg)、[继续对话](collaboration-budget-continued-narrow.jpg)。使用隔离 encrypted PGlite 与离线固定 Runtime；不是 live-provider质量证据。

本次定向组件回归9项通过，受影响eslint、typecheck/build通过；完整G0本地命令通过。未重跑无变化全测试或性能采样。其余四模式/Stop/预算耗尽、Bundle/backup/Graph完整固定状态、完整辅助技术与外部正式Gate仍待验。


## 最终状态与恢复收口（2026-10-02）

延续已批准的紧凑工作台，不增加主导航页面。正式 App/Card/BundleControls/GraphView 的固定响应入口分别为 `scripts/fixtures/m16-collaboration.html`、`m16-data.html`、`m18-graph.html`。它们使用隔离内存存储并拒绝未启用请求，未读取用户库或调用外部模型。固定样本只证明界面状态，不能替代真实 ZIP、事务、历史或 Provider 验证。

- 协作：四模式 × configure/running/partial/stopped/completed/synthesis/exhausted × 1440×900、390×844 已采集。共享布局检查及流式停止、汇总、分歧/备选披露可操作；冻结预算在收起后保留。预算结束不再引导无法执行的重试或汇总，保留已有意见与执行记录。长模型名导致 fieldset 的 min-content 溢出、长重试按钮溢出均已修复，受影响窄屏确认无局部横向溢出。初始失败测量保留在原始 observations，最终矩阵按同组合最后一次记录解释。证据：[协作状态](collaboration-state-evidence.json)，其中截图展示首屏与卡片标题；下方内容通过实际滚动、披露和动作验证，代表性分歧截图为 `collaboration-debate-disagreements-desktop.jpg`。
- 数据：warnings/missing/preflight-error/imported 与 backup-loading/ready/failed 的桌面/窄屏，及错误文件→精确补齐、导入目标读取恢复、未来模型分步响应丢失→同身份恢复、备份失败→回执恢复均已检查。长身份/摘要/位置换行，缺文件和未确认状态不能导入；没有重复导入或自动修改历史。样本工具最初受弹窗隔离或遮挡，仅修改 fixture 挂接及 hidden 样式，隐藏工具后执行真实组件动作。证据：[数据状态](data-state-evidence.json)。这里的计数是内存样本，真实幂等性继续由已有 PGlite/HTTP 证据支持。
- 图谱：正常/超预算 Tray、部分批次/手动继续、Undo 版本冲突及个人视图读取/保存失败的桌面/窄屏已检查。固定过预算样本的确认按钮禁用；真正的失败 step 代码现在显示，既有顶层 code 仍兼容。发现批次区被 flex 压成窄条，已用局部不收缩和图谱纵向滚动修复，并确认逐项结果可读。证据：[图谱状态](graph-state-evidence.json)、`graph-batch-resumed-readable-narrow.jpg`、`graph-undo-conflict-narrow.jpg`。手机同时打开 Tray 与批量面板时需要纵向滚动，画布控制与列表仍可达。
- Context：已确认来源变化导致预览失败时，明确显示已存来源并可排除，使用原有 scoped 状态命令；不静默接受新版本、不开放 pin/confirm。新增回归验证排除后恢复预览，以及只读 Workspace 不可变更。
- 个人视图：慢 GET 不覆盖新 revision，scope epoch 拒绝 A→B→A 旧回包；同 Workspace 后台刷新不会冻结 loading。独立审查发现该后台刷新反例后修复并定向确认。

本次有界视觉 verdict：PASS（以上固定状态与代表性实际交互）。这是对既有设计目标的局部功能/布局验收，不是完整 WCAG、live-provider、线上灾难恢复或整里程碑 Gate。自动检查来自 package.json：四个受影响测试文件 96/96、`pnpm run lint`、最终 `pnpm run build`（含 typecheck）通过；日志见 `../m15-m18/ui-state-*.log`。既有统一全套结果保持原证据，不因这次 UI 小修重复运行后端/性能测试。M17 Command p95 242.41ms 超过 200ms，正式门禁仍未通过；真实业务环境、保留到期、长期观察及用户验收继续单列。

## 图谱内层控制的键盘与指针隔离

剩余要求审查发现归档按钮的 Enter/Space 和 pointerup 会冒泡到节点打开/选择逻辑。已限制父节点键盘处理只接受自身目标，并排除内层交互控件的 pointerup；节点本身的键盘打开行为保留。新增五项回归，RED 中三项准确复现，修复后 GraphView 文件 18/18、两文件 ESLint、最终 build/typecheck 通过。正式组件固定样本中，桌面 Enter 和窄屏 Space 都只打开归档确认，Graph route 未变化；随后取消，没有执行归档。见 [桌面键盘](graph-archive-keyboard-desktop.jpg)、[窄屏键盘](graph-archive-keyboard-narrow.jpg)。窄屏最初尝试的节点在虚拟画布外，因此改用当前可见节点；这是 viewport 可见范围，不是交互失败。该局部确认不替代完整辅助技术验收。
