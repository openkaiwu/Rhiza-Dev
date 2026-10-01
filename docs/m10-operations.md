# M10 写路径切换与回滚操作

本地功能验证与正式 Gate 分开记录。工程检查通过不能替代真实业务 staging、备份到期验证及连续 24 小时旧写零调用观察。

本轮隔离数据、兼容旧 reader、测试修复与桌面/窄屏结果保存在 [本地工程验收记录](../reports/m10-local/README.md)；机器可读结果明确保留外部 Gate pending。

## 切换预检与对账

先停服并保留数据库、对应密钥和上传目录。检查命令取得原有 runtime ownership，不允许与另一 PostgreSQL Chat runtime 同时运行。必须显式选择目标路径；PGlite verify 模式只打开已有库，不初始化、不补 baseline、不执行 migration。

```sh
RHIZA_EMBEDDED_DATA_DIR=/absolute/path/database \
RHIZA_UPLOAD_DIR=/absolute/path/uploads pnpm run m10:preflight

RHIZA_EMBEDDED_DATA_DIR=/absolute/path/database \
RHIZA_UPLOAD_DIR=/absolute/path/uploads pnpm run m10:reconcile
```

PostgreSQL 使用 `DATABASE_URL` 和 `RHIZA_UPLOAD_DIR`；`RHIZA_RECEIPT_CONTENT_DIR` 指向对应历史加密目录，默认为 `var/receipt-content`。命令核对所有已应用 migration checksum，并按 Workspace 比较 Current State 与 Journal baseline/tail，检查明文副本、引用密钥健康、Provenance、历史输入和 Blob 摘要。JSON 只输出 ID、计数、checksum 与安全错误代码，失败 exit 1。发现缺失 baseline、历史不一致或旧明文时保留原数据，先使用已有明确迁移/恢复命令修复，再对账；检查命令不自动修改它们。

## 工程回归与回滚演练

```sh
pnpm run m10:checks
pnpm run m10:rollback
pnpm run m10:rollback 5bc8466
pnpm run m10:legacy-writes
```

`m10:checks` 聚合历史不可变、拒绝回退、多 Workspace 对账、生产旧入口拒绝、跨 Workspace 冲突、回滚演练和调用检查。回滚演练仅在新建临时目录运行，不接业务数据库；覆盖两个 Workspace、附件、Chat / Run / Manifest / Journal、Bundle checksum、Purge 和回执重试。它解出兼容基线的实际代码，使用旧 reader 读取当前 schema 下的数据，再恢复新代码验证已提交命令没有重复模型调用。成功与失败都输出 JSON / exit code，临时库最终清理。

`GET /api/health` 的 `legacyWrites` 提供当前进程观测窗口、入口、操作和计数。部署观察需保存启动时间及窗口连续性；不能通过重启计数器或新建离线进程声称连续 24 小时通过。`m10:legacy-writes` 是只读静态调用检查，不能代替运行时证据。

## 配置迁移

新内容目录记录数据库归属；服务与维护命令统一使用 `RHIZA_RECEIPT_CONTENT_DIR`（PostgreSQL 默认 `var/receipt-content`）。该目录不能跨数据库共享，禁止外部程序绕过 lifecycle 锁发布 document。旧非空目录没有 marker 时不会自动认领。若出现 `PURGE_OFFLINE_KEY_RECONCILIATION_REQUIRED`，当前正文已由事务墓碑/覆盖层拒绝读取，checkpoint 仍 pending：保持停服，确认目录仅属于目标数据库后运行既有 `RHIZA_OFFLINE_KEY_RECONCILIATION=1 pnpm run m09:keys:reclaim`，再启动服务恢复撤钥；不要手工改 checkpoint 或复制 marker。Purge 预检会对 pending checkpoint 和未撤销清单给出非零失败结果。

归档节点的图谱列表提供“永久清除”，要求准确输入 `PURGE <nodeId>` 和原因，保留服务器活跃 Run/跨节点引用检查。窄屏底栏“工作区”入口复用现有 Bundle 预检、导入和下载控件。

`postgresPersistence` 仍控制 PostgreSQL 选择，并要求 `DATABASE_URL`。`libreChatRuntime`、`fileContext` 原来没有接线，现已移除；即使配置为 false 也会在启动时提示移除这些条目。Provider Runtime 与文件 Context 继续由现有生产 composition root 接线。

回滚期间保持当前 schema、Journal、Bundle v1 和全部加密目录。禁止执行 down migration 或恢复已经 Purge 的正文。不得通过旧 JSON Store 接管生产写入。正式 M09/M10 Gate 仍需补齐暂缓的外部证据。
