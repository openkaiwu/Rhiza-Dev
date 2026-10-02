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
