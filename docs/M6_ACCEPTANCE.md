# M6 Acceptance — Product UX Hardening

> **Historical Evidence Only(2026-08-22)**:本文件是 Legacy 里程碑验收证据,其编号不定义当前 Milestone。当前基线见 `docs/Rhiza_开发路线图_V4.1_20260824.md`(统一 M01+ 编号)。

## 验收映射

- [x] 首次进入可理解 Project / Node / Graph / Context：首次引导逐项解释四个概念，并可从“帮助与快捷键”再次打开。
- [x] 常用操作有快捷键：命令面板支持 `Cmd/Ctrl+K`，并提供视图切换、Context、输入框聚焦和 Escape 关闭。
- [x] 主要操作不依赖隐藏右键菜单：侧栏、Chat header、Graph toolbar、Context Inspector 和命令面板均提供可见入口。
- [x] Graph 与 Discussion 状态同步：共用 active node；从 Graph 打开节点回到对应 Discussion，自动化测试覆盖视图往返。
- [x] 刷新、网络重连和模型错误可恢复：启动失败可重试；离线时禁发并播报；重连自动刷新；既有 Chat 测试覆盖失败后的 Retry。
- [ ] 100 Node 连续使用一小时无明显内存增长：仍需真实浏览器长时测试，不能由短时单元测试替代。
- [x] 核心页面具备 Loading / Empty / Error / Offline：启动、空工作区、空 Chat、Graph 无结果、全局错误和离线状态均有显式呈现。
- [x] 主要桌面分辨率布局可用：继承 1120px / 820px / 760px 响应式断点、Context 抽屉和 reduced-motion；production build 已通过。
- [ ] 一轮真实用户可用性测试及 P0/P1 修复：等待外部测试者与研究记录，仓库不伪造用户证据。

## 自动化证据

- `src/App.test.tsx` 覆盖启动加载/失败重试/空工作区、离线禁发/重连刷新、首次引导、命令面板、快捷键和 Graph/Chat 同步。
- `src/components/GraphView.test.tsx` 继承 300 Node 搜索、聚焦、fit view 与节点创建/删除覆盖。
- 全量 M0–M5 门禁、M6 类型检查与 20 项 App 测试由 `npm run verify:m6` 串联执行。

## 本次验证结果

```text
lint: passed
typecheck: passed
unit: 64 passed
e2e: 5 passed, 1 skipped (requires external PostgreSQL)
licenses: 362 production packages verified
production build: passed
M6 App tests: 20 passed
```

## 人工回收清单

1. 载入 100 Node 项目，在生产构建中连续执行聊天、Graph 缩放/搜索、节点切换和 Context 开关一小时，记录起止 heap、DOM node 与 listener 数量。
2. 邀请未接触 Rhiza 的真实测试者完成首次进入、创建/切换 Node、从 Graph 返回讨论、调整 Context 和离线恢复任务；记录完成率、P0/P1 问题和修复版本。

在这两项证据完成前，M6 工程开发已完成，但完整产品验收不能标记为全部通过。
