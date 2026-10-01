# ADR-010 — 唯一生产写路径、对账与兼容回滚

Status: Accepted for engineering implementation; M09/M10 formal Gate pending external evidence.
Date: 2026-10-01

生产 Workspace 变更由 Application Command → WorkspaceUnitOfWork → `executeCommand` 提交。Command context、事务能力、Workspace 锁、Current State / Journal / Receipt 同事务及提交前语义读回对账缺一不可。缺少 context 或事务适配器时返回明确错误，不调用旧 `update()`；关系存储的旧入口稳定返回 `LEGACY_WRITE_DISABLED`。JSON Store 只用于显式迁移读取与测试夹具，生产启动只接 PostgreSQL/PGlite。

初始化、Bundle 激活、资源回填、派生投影重建及停服恢复分别保留明确入口。Bundle v1、现有 HTTP 契约、owner/scope 策略、runtime ownership、checkpoint 与密钥生命周期继续使用现有边界。资源回填使用可重复 Command；离线加密迁移继续使用其原有分批验证事务，不伪装成业务写入。

关系持久化从前后状态计算显式 inserted / updated / deleted 集合。业务对象新增使用 INSERT；可变对象更新和删除带 Workspace 谓词，缺少 Workspace 列的表通过所属 Node/Resource 约束。旧全量 `deleteMissing` 与对象通用 upsert 被移除。既有 `rhiza_projects.state` JSON 布局保留，只合并发生变化的 mode / contextItems / fileChunks，避免 schema 变更或丢失其他存储字段。

Message 内容、Manifest、ResourceVersion 历史保持不可变；编辑重发与重新生成追加新版本。Message 的 Segment 归属是明确关系调整。Purge 仅允许清除确已删除 Message 的 source/reply 引用，不能借此改写正文或版本。所有新引用在持久化前验证闭合及 Workspace 身份，跨 Workspace ID 碰撞必须拒绝。

Purge 按受影响对象清单依次处置关联、Message、Manifest、Segment、Attachment、审计 Node 关系、布局和 Node；不依赖 Node DELETE 的数据库级联决定内容范围。现有数据库外键仍是完整性防线。tombstone、Journal 脱敏覆盖、回执不可读标记、所有已保存图投影脱敏、候选索引清理和撤钥 checkpoint 继续在既有事务/恢复边界执行。密钥撤销在提交后幂等恢复。活跃 Run、跨节点执行历史及其他 Workspace 独立副本保护不变。

旧入口观测仅保存稳定入口、操作与计数，通过 health 只读暴露。计数窗口是当前进程；重启会开始新窗口，零计数不能证明连续 24 小时，也不能代替部署环境观察。静态检查按 Workspace storage 类型寻找旧调用；两处明确 JSON fixture 桥保留，由拒绝回退的行为回归约束。ProviderStore 配置写入属于独立外部配置边界，不计作 Workspace 写入。

回滚只允许使用能读取当前完整 schema、加密引用、Journal 和 Bundle v1 的代码版本。演练对选定旧版本逐项核对 migration checksum，并实际运行旧代码 reader 读取新数据，再用新代码恢复和验证提交回执。默认兼容基线是 `5bc8466`。不得执行 down migration、恢复 Purge 前正文或丢弃新历史；不删除旧表或用户数据，不回滚加密迁移。生产部署切换前先停写并取得 runtime ownership，失败时保持原数据库与密钥目录。

可变密文与旧 Journal 覆盖层留下的过期 document key，必须在 checkpoint 标记 revoked 前收口。新建内容目录由 `.database-owner` 绑定实际数据库/schema/OID（PGlite 使用绝对数据库路径）；同一目录不得跨数据库共用，所有受支持 document 发布者使用同一内容生命周期锁。Purge 的 post-commit 恢复在同一 exclusive 事务和全库引用快照下撤销未引用密钥，保留其他 Workspace 的全部当前引用；ResourceVersion Blob 和恢复归档仍使用各自 scoped 清单。既有非空目录不自动认领；有 orphan key 时 checkpoint 保持 pending，先停服运行既有全历史密钥对账/回收，再恢复 checkpoint。只读预检不创建 marker，不撤钥。

本轮复用项目现有 PGlite/pg、Application/UoW、语义 checksum、Bundle、安全归档和 checkpoint 实现，不引入新的第三方代码或依赖。真实业务 staging、备份到期和 24 小时零旧写观察单独待验，正式 Gate 不据此标记 Done。
