# M11–M14 本机工程交付证据

实现分支 `update1002`，原始基线 `789f54c`，实现 `1145401`，审查修复 `21a6698`。提交保留在本地。功能开发完成；正式 Gate 未通过。

- `verification.json` / `logs/`：409 unit + 122 E2E 的整体验证通过，另补2项定向检查通过，共533个不同用例；94个 PostgreSQL 用例因环境未配置而跳过。lint/build/licenses/M02/M04/M10写边界通过，M14聚合检查通过。
- `review.json`：一次独立审查、一次修复；1 Critical + 5 Important 均有失败复现及通过回归，无再次审查循环。日志保留断言/结果，去除了颜色转义和机器绝对路径。
- `browser/report.json` / PNG：1440×900、390×844各一轮；讨论、Segment、搜索、Stop、临时流式、Merge、Graph核心操作通过，无页面错误。
- `browser/graph-performance.json`：修复后的21a6698，300节点、20预热/200样本；事件到React DOM提交p95 0.5ms/p99 1.1ms，视口外DOM=0，Domain不变；不包含显示合成器延迟。
- `performance.json`：实现工作树在1145401之前测量，保留原commit/dirty记录；encrypted PGlite、300 Conversations、10k Graph objects/50k edges、20预热/200样本。Graph/Context/Trace预算通过，Command p95 673.1ms/p99 2624.1ms仍超200/500ms。
- `command-profile.json`：21a6698上20次短诊断，非正式Gate采样。完整Workspace双读约占63.5%耗时；阶段计时嵌套，不能相加，不替代正式百分位门禁。
- `linear-sync.json`：29项回读确认；22功能Done，2 In Progress、4 In Review、1 Backlog。正式M11–M14 Gate保留。

当前G0 additive contract drift、相对性能环境不可比、真实staging三次一致、真实多会话dogfood、备份到期及连续24小时旧写零调用证据均未签署通过。保留历史G0档案、当前schema/加密/影子对账与Purge保护，未执行down migration或业务数据清理。

复跑命令由package.json提供：`pnpm run lint`、`pnpm run build`、`pnpm run test`、`pnpm run licenses:verify`、`m11:checks`–`m14:checks`、`benchmark:m11`。M11检查在Command性能失败时返回非零；这不被跳过或降低阈值。详细功能与证据对应见 `docs/m11-m14-engineering.md`。
