# M09–M10 本地工程验收

分支 `update1002`，兼容回滚基线 `5bc8466`。本目录是隔离 PGlite、离线模型的本地工程记录，不是正式 M09/M10 Gate 证据。

最终 lint、build（含 typecheck）、许可证、G0、M02/M04 边界检查通过。M10 聚合检查 28 项通过；新增目录归属竞态回归 2 项通过；最后的 App/Purge UI 定向检查 34 项通过。预检与对账两次结果一致，mismatch 为 0；缺少显式路径返回 exit 1；实际兼容旧 reader 的回滚演练通过，恢复后没有重复模型调用。

首次 `pnpm run test` 的 unit 阶段为 368 通过、11 失败；失败均在受影响文件定向复验中修复。首次 E2E 为 113 通过、1 失败、94 跳过；剩余失败是历史未加密 Run 的预期拒绝代码，修改对应预期后单项通过，409 与无变更断言保留。遵循本轮测试预算，没有无变化重跑全部套件，也不声称最终整条 `pnpm run test` 被重跑并通过。94 项真实 PostgreSQL 用例因本机无已配置可用数据库跳过。

桌面与窄屏均完成带附件导出、空库导入、来源/历史 Context、继续对话、Replay 和 Purge。最终界面检查覆盖独立 Portal 的 Purge 确认框、窄屏工作区菜单和不被底栏遮挡的发送控件。截图仅包含合成数据。

- [机器可读验收记录](verification.json)
- [预检](preflight.json)、[重复对账](reconcile.json)、[失败退出码案例](preflight-failure.json)
- [实际旧版本回滚演练](rollback-cli.json)
- [浏览器结果](browser/results.json)、[桌面 Purge](browser/desktop-purge-confirm.png)、[窄屏 Purge](browser/narrow-purge-confirm.png)、[窄屏工作区菜单](browser/narrow-workspace-menu.png)
- [切换与恢复操作说明](../../docs/m10-operations.md)

真实业务 staging、备份到期验证和连续 24 小时旧写零调用观察暂缓；正式 Gate 保持 pending。旧非空内容目录若没有数据库归属 marker，孤立密钥清理需明确离线对账，不能手工认领目录或关闭 checkpoint。
