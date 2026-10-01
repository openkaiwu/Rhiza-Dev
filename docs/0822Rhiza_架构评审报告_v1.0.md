# Rhiza 架构评审报告 v1.0

> 文档状态:系统性 Architecture Review / 独立评审意见
> 日期:2026-08-22
> 评审范围:`docs/` 全部架构文档(0815 v2.3、0818 v3.0、0818 路线指南 v1.0、architecture.md、librechat-migration.md、M0–M6 验收、architecture-gates)+ 当前 `main` 分支全部核心代码(`server/`、`src/`、`db/migrations/`、`scripts/architecture-gates/`)
> 评审立场:不追求"更先进"的架构,只判断当前设计是否稳定、合理、高效、可维护,并能以较低迁移成本支撑长期演进
> 代码验证说明:除明确标注"需要代码验证"的条目外,本报告所有代码事实均已直接阅读源码核实

---

# 0. 结论摘要(TL;DR)

1. **文档层面的目标架构(0818 v3.0)总体判断:合格且克制,应当保留为施工基线。** 它准确诊断了 Legacy 实现的全部关键缺陷(本次评审逐条在代码中复核属实),物理实现上坚持模块化单体 + 单 PostgreSQL,明确拒绝了 Kafka / 微服务 / 完整 Event Sourcing / CQRS 平台。核心数据体系(Workspace 根、Event/Trace/Stream 三分、ExecutionRun、不可变 Manifest、内容寻址 ResourceVersion、Graph-as-Projection)是一致的,能支撑 history、provenance、branch/fork、replay 与 observability。
2. **代码层面的现状:目标架构 0% 落地,且 Legacy 实现每天都在破坏"历史不可变"这一产品核心承诺。** 当前处于 R0/G0(冻结与表征)阶段,这是正确的;但 Graph 节点删除会物理级联删除消息与 Manifest、PostgreSQL 适配器用 `deleteMissing` + mutable upsert 持久化、Manifest 可被覆盖更新——在 dogfood 期间产生的所有历史都不可恢复。这是唯一一类"现在必须处理"的代码问题。
3. **最大的真实风险不在架构模型,而在执行经济学:** R1–R6 是一条约六个批次、以基础设施为主的迁移链,期间不产生新用户价值;G0–G8 定义了数百个量化门槛(故障注入、四平台矩阵、zip 攻击套件、100 并发命令等)。以当前团队规模(证据显示为极小团队/单人),Gate 维护成本可能吞噬开发本身。建议对 Gate 做分级(阻断级 vs 观测级),并压缩 R6 Bundle 的首版范围。
4. **两个被路线图遗漏的硬缺口:** (a) 多 Workspace 与最小用户身份——当前代码是单 Workspace 单例(`DEFAULT_PROJECT_ID`,无鉴权),而 WP-2.3 Closed Beta 需要 8–15 名外部用户;(b) ExecutionRun 状态机缺少 pause/resume 语义占位,而 v2.3 的 ExecutionProvider 协议与 Multi-Agent 路线明确要求 pause/resume。两者都应在对应批次(R1、R3)补上契约位,避免 Phase 2 重开状态机。
5. **文档治理总体良好但有三处需要立即修正:** `librechat-migration.md` 的"clean-base 迁移门槛"已被 v2.3/v3.0 实质废止但未标注;`architecture.md` 与 M2 验收关于 PostgreSQL 运行时状态的表述互相矛盾;v3.0 §21 要求 R1–R3 前完成 16 份 ADR,但仓库中**不存在任何 ADR 文件**——按其自身规则,R1 尚不具备开工条件。

**核心判断标准的回答:** v3.0 目标架构能够承载未来的 Context Intelligence、Multi-Agent Orchestration、Adaptive Model Routing、Plugin/Capability、Workspace/Artifact 与 AI Runtime 扩展,预留 seam 的方式(只加对象/事件类型,不改内核语义)是正确的。风险不是"设计不够",而是"设计远超当前实现,且迁移路径的固定成本偏高"。按本报告第 9 节的优先级执行,可以把架构摩擦控制在可接受范围。

---

# 1. 文档地形:生效版本判定与过时文档清单

## 1.1 生效文档链(评审确认)

| 文档 | 地位 | 判定 |
| --- | --- | --- |
| `0815Rhiza_三步走开发战略与架构重构规划_v2.3` | 产品战略与长期路线基线 | **生效**。产品定位、三阶段、架构红线、Kernel 边界清单以此为准 |
| `0818Rhiza_技术架构设计书_v3.0` | 目标技术架构与 Gate 唯一基线 | **生效且优先级最高**(其 §0 自我声明高于旧 M0–M6 口径,评审认可) |
| `0818Rhiza_三步走开发路线指南_v1.0` | 施工路线(WP → R/G → P1-M 映射) | **生效**。命名空间治理(Legacy-M / P1-M / R / G / WP)清晰,解决了编号冲突 |
| `docs/architecture.md` | 当前已部署实现说明 | **生效但有一处过时**(见 1.2 第 3 条) |
| `docs/M0–M6_ACCEPTANCE.md` | Legacy 工程证据 | **生效,仅作 Legacy-M 证据**;M6 两项人工缺口已在 G0 evidence 中正确登记为 pending |
| `docs/architecture-gates/**` | G0 证据与 fixture/schema 契约 | **生效**,且是全仓库工程纪律最好的部分 |
| `docs/know-how.md`、`product-design.md` | 实践备忘 / 产品原始设计 | 生效,辅助性 |

三份文档的分工(v2.3 管"为什么"、v3.0 管"是什么"、路线指南 v1.0 管"怎么排")是健康的,且互相引用一致。施工顺序上,v2.3 §15 建议的"先 Run(M3)后 Graph(M2)"与 v3.0 的 R3→R4 顺序一致,不构成冲突。

## 1.2 过时或可能误导开发的文档(需处理)

1. **`docs/librechat-migration.md` — 已实质过时,当前最容易误导开发。** 它基于更早的《ContextGraph 技术设计书 v2.0》,定义的目标是"LibreChat v0.8.7 clean-base + Mongo 出现在 adapter 边界 + `AIRuntime` 含 `invokeTool`/`runAgent`"。已代码验证:当前 `server/ai-runtime.ts` 的 `AIRuntime` 只有 `listModels`/`generate`,没有 `invokeTool`/`runAgent`;v2.3/v3.0 的方向已变为"Rhiza 自有 Kernel,LibreChat 仅作 Runtime 参考源与 `librechat-data-provider` schema 依赖"。该文档的 §5 "clean-base gates"(如"Rhiza Domain 使用 PostgreSQL 作为 Source of Truth、Mongo 仅在 adapter")与 v3.0 的 R0–R8 是两套互不兼容的验收口径。**建议:标注 superseded 头注,或移入 `docs/archive/`,保留 upstream commit 锁定信息(那部分仍有效)。**
2. **`docs/archive/Rhiza_Phase1/2/3_*.md` — 已正确归档,无需处理。** 但它们没有头注说明被谁取代;建议在每份头部加一行"superseded by 0815 v2.3",防止新协作者误读(这三份的 M 编号语义与现行 P1-M 不同)。
3. **`docs/architecture.md` §10 与 `M2_ACCEPTANCE.md` 矛盾。** architecture.md 称"PostgreSQL schema/migration baseline 已完成,产品数据存储切换属于 M2(未来)",而 M2 验收记录称 PostgreSQL 持久化已交付(`postgresPersistence=true` 显式开启)。已代码验证:`server/postgres-store.ts` 是完整可用的运行时实现,由 feature flag 控制。architecture.md 应改为"已实现、默认关闭、由 flag 启用"。
4. **v3.0 §21 的 ADR 索引是空头支票。** 仓库中不存在任何 `ADR-*` 文件(docs/ 下无 adr 目录)。v3.0 自己规定 ADR-001~016 必须在 R1–R3 前完成,路线指南 §25 也把"WP-1.1 前 ADR"列为下一个决策会内容。这不是文档冲突,而是**执行缺口**:按现行规则,R1 目前不允许开工。
5. **仓库卫生问题(顺带发现):** `Rhiza-Dev-codex-rhiza-librechat-runtime.zip`(184KB)及其解压目录(含 `var/data/workspace.json`、`var/data/providers.json` 运行时数据快照、`.DS_Store`)被提交进了 git。providers.json 当前未含密钥字段,但把运行时数据目录入库违背了自家"fixture 必须脱敏、显式注册"的 G0 纪律。建议删除并加入 `.gitignore`。

---

# 2. 整体架构评价

## 2.1 现状架构(Legacy,已代码验证)

一句话概括:**一个约 5,300 行、结构干净、测试认真的"单 Workspace 文档式单体"**——所有状态(消息、节点、边、Context、Manifest、审计)装在一个 `WorkspaceData` 聚合里,JSON 文件或 PostgreSQL 都以"读全量 → 变异 → 写全量(差量 upsert + deleteMissing)"的方式持久化,进程内串行队列保证单写者。

值得肯定的现状:

- `server/domain.ts` 是纯类型定义,无 Express/React/fs/SDK import(已验证);
- Runtime 事件契约(`RUN_START/CONTENT_DELTA/REASONING_DELTA/TOOL_CALL_DELTA/USAGE/RUN_END/RUN_ERROR`)与"只有 `RUN_END` 才原子提交、`RUN_ERROR` 零持久化"的语义,正是 v3.0 RuntimeAdapter 的雏形,可平移;
- Manifest 已冻结结构化 items(来源、原因、selectionMode、token),不是只存拼接后的 prompt,给 R5 留了正确的数据形状;
- G0 characterization + evidence manifest + fixture 注册 + CI 基线的证据纪律,超过绝大多数同规模项目。

现状的结构性缺陷(全部已在 v3.0 §0 被自我诊断,本次评审逐条在代码复核属实):

| # | 缺陷 | 代码证据 |
| --- | --- | --- |
| 1 | Graph 删除物理销毁历史 | `app.ts` `DELETE /api/graph/nodes/:id`:级联删除该节点全部 messages、anchors、segments、**manifests** |
| 2 | 持久层可变且破坏性 | `postgres-store.ts`:manifest `ON CONFLICT DO UPDATE SET manifest=EXCLUDED.manifest`(Manifest 可被改写);`deleteMissing()` 物理删除快照中不存在的行 |
| 3 | AuditEvent 无信息量 | 每次 update 只追加一条 `workspace.updated`,不含语义;不能替代 Domain Journal |
| 4 | 模型调用无持久身份 | 无 ExecutionRun 表/对象;`RUN_ERROR` 除日志外零记录;requestId 只存在于成功提交的 Manifest 内 |
| 5 | Graph 是会话专用结构且全量加载 | `DiscussionNode` 把 UI 坐标 x/y 放在领域对象里;前端经 `GET /api/workspace` 全量拉取 |
| 6 | Planner 每轮全量扫描 | `context-planner.ts` `candidates()` 每次 chat 遍历全部 nodes×messages×segments 并重算 tokenize+embedding(file chunk 除外) |
| 7 | Manifest 无真实版本/哈希 | `contentVersion` 恒为 1,无 content digest,无 planner/compiler version 字段 |
| 8 | 无 Application 层 | 全部业务逻辑写在 `app.ts` 的 Express route handler 内(590 行);上传直接在 handler 里写文件系统 |
| 9 | 边界守护极弱 | `architecture.test.ts` 仅用正则检查 domain.ts 文本不含 librechat/mongoose;ESLint 无任何 boundary 规则;无 packages/ 结构、无 project references 边界 |
| 10 | 单 Workspace 单例、无身份 | `DEFAULT_PROJECT_ID = '00000000-...0001'`,无 auth、无多 workspace CRUD |

## 2.2 目标架构(v3.0)评价

**模型层:优。** Workspace 为根(I-01)、Event/Trace/Stream 三分(I-02)、Current State + Journal 而非全量 Event Sourcing(I-03)、Graph 为 Projection(I-05)、Manifest 不可变(I-06)、Resource identity 与位置解耦(I-07)、Headless Core(I-08)、外部调用不进本地事务(I-09)——这十条不变量彼此自洽,且每一条都能对应到一个真实的产品能力(branch/replay/provenance/observability/可移植),不是模式崇拜。特别值得肯定的是三处克制:

- 明确的非目标清单(§2.2)和"预留 = 未来只加模块和 event/object type,不是今天实现空壳平台"(§23)的预留标准;
- ContextEnvelope v0 → Manifest v1 两级契约,拆掉了 R3/R5 的循环依赖;
- CloudEvents/OTel/OCI/JSON Schema 只采语义不绑框架(§24)。

**协议层:良,但有前置过重的苗头。** ExecutionRun 在 Phase 1 就携带 lease_owner/lease_epoch/fencing/dispatch_idempotency_key 等分布式租约机制,针对的是"外部副作用型 Agent/CLI"——这个设计本身正确(崩溃恢复语义现在不定,以后没法补),但对 Phase 1 唯一的实际负载(无副作用的 LLM chat 调用)是超配的。风险不是错,而是 G3 的验收成本(三崩溃点注入、fencing 竞态全覆盖)全部压在一个当前用不到完整能力的机制上。建议见 §7。

**缺口两处(模型层面):**

1. **Run 状态机没有 pause/resume。** v3.0 状态机为 `created → dispatching → running → {completed|failed|cancelled|timed_out|interrupted}`(已全文检索确认无 pause),而 v2.3 §2.6 的 ExecutionProvider 长期协议明确有 `pause(run_id)/resume(run_id)`,Multi-Agent 路线(WP-3A.5、M3.5 Lease)要求"可单独 pause/cancel"。若 Phase 2 才补 paused 状态,会触碰"终态不可回退"和事件 catalog 的兼容规则,属于本可避免的一次契约破坏。修法很便宜:R3 时在状态 enum 与 event catalog 预留 `run_paused/run_resumed`(或声明 pause 是 Assignment 层语义、Run 只有 cancel),写进 ADR-007 即可。
2. **多 Workspace 与最小身份不在任何 R 批次。** I-01 要求一切对象有 workspace_id,schema 也按复数 workspace 设计,但没有任何 WP 交付"创建/打开/列出 Workspace + 最小 actor 身份"。Closed Beta(8–15 外部用户)要么每人自托管、要么共享部署——前者需要打包分发,后者需要 auth,两者都不在路线图上。这不是架构错误,是**里程碑遗漏**,应在 R1(identity 工作包)内补一个"Workspace CRUD + 单用户本地身份"的最小纵切,并在 WP-2.1 前决定 Beta 部署形态。

## 2.3 十个审查维度的逐项裁定

| 维度 | 裁定 | 关键依据 |
| --- | --- | --- |
| 1. 模块职责/依赖 | 目标设计清晰;现状"基础设施即领域"(逻辑在 route handler、坐标在领域对象),按 R1/R4 修复即可,无需额外方案 | §2.1 表 |
| 2. Domain 独立性 | 类型层已独立且被测试守护(弱);行为层未独立。LibreChat 侵入被成功挡在 `librechat-shared.ts`/数据依赖层,**这是 Legacy 做对的最重要一件事** | 已验证 |
| 3. Runtime/Kernel/Capability/Plugin 边界 | 合理。稳定核心协议应收敛为:ObjectRef/Event/Run/Manifest/ResourceVersion/StorePort/RuntimeAdapter/HostPort 八项;v2.3 §2.2 列的 14 个协议面中 Extension/Capability/Routing/Lease 应保持 draft 直到有真实使用方,避免"冻结从未被使用的协议" | §5.3 |
| 4. 核心模型一致性 | 一致。Event→Projection、Run→Manifest→Provenance、Resource→Version→Blob 三条链闭合,支持 history/provenance/branch/replay/observability;Snapshot 契约(§5.7)在 Phase 1 属可选优化,不应成为 G2 阻断项 | §5.1 |
| 5. Context 演进性 | Contributor/Index/Planner/Compiler/Manifest 流水线可自然演进到 Context Planning、Context Graph、长期记忆(新增 contributor 类型)与多 Agent 隔离(manifest per run + scope 入 cache key),不会触发大规模重构;当前 per-turn 全扫描在 300 节点约 3ms,**不是现在的性能问题,是 R5 的架构问题**,不必提前 | §5.4 |
| 6. Multi-Agent 承载力 | seam(parent_run_ref/run_group_ref/assignment_ref、RunGroup、Handoff、TaskPlan revision)足够;缺 pause/resume 契约位(见上);人工接管(take over)建议在 ADR-007 里定义为"cancel + 人工产物挂到同一 RunGroup",不需要新机制 | §2.2 |
| 7. 模型路由承载力 | 分层正确:Phase 1 只落 ModelSpec/ProviderEndpoint identity + per-run telemetry,评分/路由引擎推迟。Endpoint 级身份是防止未来重写的关键一步,R3 落地即可;现有 provider/model UUID 目录可直接 backfill 为 ProviderEndpoint | 已验证 |
| 8. 数据层/事务 | 同事务 State+Journal+Receipt、per-workspace sequence、append-only DB 防护——收益/复杂度比合理;拒绝 ES/CQRS 的决策正确(Journal 在这里不是"架构品味",branch/replay/provenance 就是产品功能本身)。现状 RMW 存储是最大负债 | §5.2 |
| 9. 性能/并发/跨平台/部署 | 目标阈值(p95≤200ms、10k/50k Graph、10k trace flood)量级合理;HostRuntimePort + 四平台 fake matrix 是低成本高回报的跨平台策略;PGlite embedded 路线可行(已是 devDependency) | §6 |
| 10. 路线图匹配度 | 顺序正确(先 Identity/Journal,再 Run,再 Graph/Context,后 Bundle/收口),但**价值真空期长、Gate 固定成本高、两处里程碑遗漏**,需按 §7 调整 | §7 |

---

# 3. 值得保留的设计(不要动)

1. **文档三层治理与命名空间纪律**(Legacy-M / P1-M / R / G / WP)——解决了真实发生过的验收语义冲突。
2. **十条架构不变量(v3.0 §2.3)全部保留**,它们是本报告其余建议的前提而非对象。
3. **Current State + Append-only Journal、不做全量 Event Sourcing**——这是全套设计里最重要的一次"说不"。
4. **Event/Trace/Stream 三分与 trace 不进业务事务**——对 Agent 时代的高频 trace 是唯一可行的物理形态,且已给出 OTel 式 batch/backpressure 参数。
5. **Graph 是可重建 Projection + Layout 分离**——修复 Legacy"删视图=删历史"的正确方式。
6. **不可变 Manifest + ContextEnvelope v0/Manifest v1 两级契约**。
7. **内容寻址 ResourceVersion + Blob promote 协议 + identity 与路径解耦**——可移植性的地基,越早越便宜。
8. **ExecutionRun 统一执行抽象 + Endpoint 级模型身份**——避免 Phase 2/3 两次注定的重写(LLM→Agent 统一、模型名→Endpoint 评分)。
9. **Headless Core + Host capability descriptor(四平台 fake matrix)**——用契约测试而非真机矩阵换跨平台置信度,性价比极高。
10. **`workspace.rhiza` 逻辑 Bundle 而非数据库 dump**,含 zip 攻击防护清单。
11. **G0 的证据基建**(evidence manifest schema、fixture registry、CI attestation、canonical checksum 规则)——保留并复用到 G1+,不要重做。
12. **Legacy 代码中的 Runtime 事件契约与"RUN_END 原子提交、RUN_ERROR 零持久化"语义**——迁移时保 contract 换实现。
13. **克制清单**(v3.0 §2.2 非目标、§23 延后复杂度、v2.3 §11)——评审确认其中没有一项应该提前。

---

# 4. 问题与技术债务(按严重程度排序)

> 严重程度:P0 = 现在必须修改,否则继续开发形成明显风险;P1 = 当前可保持,但必须在指定 Milestone 修;P2 = 下一 Phase 处理;P3 = 长期方向,现在只留接口/数据基础。

## P0-1 热路径破坏历史:级联物理删除 + 可变 Manifest + deleteMissing

- **问题与根因:** `DELETE /api/graph/nodes/:id` 物理删除节点下全部消息、anchors、segments 和关联 Manifest;PostgreSQL 适配器对 Manifest 做 `ON CONFLICT DO UPDATE`,并用 `deleteMissing` 把内存快照中消失的行从库里删掉。根因是"整个 Workspace 是一个可变文档"的持久化模型,删除/更新语义天然是破坏性的。
- **风险:** Rhiza 的产品差异化承诺(历史可追溯、Replay、Provenance)正在被自己的删除按钮持续否定。dogfood 与未来 Beta 期间损失的历史**不可回补**——R2 的 backfill 只能回填仍然存在的数据。这也是唯一随时间**单调恶化**的问题。
- **严重程度:** P0(数据层面);实现工作量却很小。
- **推荐方案(最小止血,不等 R4):** ① 删除节点改为默认 `archived`(状态机已存在 archived 状态与只读语义),真删除入口保留但要求显式确认并只允许对 archived 节点执行;② 去掉 manifest upsert 的 `DO UPDATE` 子句(改 `DO NOTHING`),`deleteMissing` 对 `rhiza_context_manifests` 与 `rhiza_messages` 停用或改为 tombstone 标记。③ 在 G0 characterization 中把这两处登记为**有意语义变更**(路线指南允许:每项语义变化必须有意且可审计)。
- **涉及模块:** `server/app.ts`(delete 路由)、`server/postgres-store.ts`、`server/store.ts`、对应测试与 G0 fixture。
- **渐进迁移:** 本项就是 R4/R7 目标语义(archive/tombstone)的提前 1%,不产生额外迁移;R4 落地后删除该临时路径。
- **建议阶段:** 立即(R0 收尾与 R1 之间)。
- **验证方式:** 新增回归测试"删除 Graph 节点后 Manifest 与消息仍可通过 API/DB 解析";`deleteMissing` 单测断言 manifests/messages 表不再出现在删除语句集合中。

## P0-2 ADR 空缺阻塞 R1(流程性 P0)

- **问题与根因:** v3.0 §21 与路线指南 §25 均规定 R1 开工前须完成关键 ADR(至少 ADR-002 依赖方向、ADR-003 Identity/Scope、ADR-004 Resource identity/哈希、ADR-005 State+Journal);仓库中零份 ADR。根因:文档基线是一次性大设计,ADR 被当成了"以后补的手续"。
- **风险:** ADR 缺位时,v3.0 中互相关联的不可逆决策(ID 保留策略、sequence 分配、blob 协议)会在实现压力下被局部偏离,而没有任何机制发现;Gate 无法引用决策依据。
- **严重程度:** P0(流程),工作量低——v3.0 已包含全部决策内容,ADR 只是把它们切成可单独废止的单元。
- **推荐方案:** 建 `docs/adr/`,先写 4 份(002/003/004/005),每份 1–2 页,直接引用 v3.0 章节作为规格,补"考虑过的替代方案"与"废止条件"。其余 12 份按批次 just-in-time 写。
- **建议阶段:** 立即,R1 前。
- **验证方式:** R1 的 PR 描述必须引用对应 ADR 编号;G1 evidence 增加 `adr_refs` 字段(schema 已在 Step 3 Future Gate 中定义过同名字段,复用)。

## P0-3 仓库卫生:入库的 zip 与运行时数据快照

- **问题:** `Rhiza-Dev-codex-rhiza-librechat-runtime.zip` + 解压目录(内含 `var/data/*.json` 运行时数据、`.DS_Store`)被提交。当前未见明文密钥,但该目录形态(providers.json)正是加密密钥的存放位置,属于"下一次提交就可能出事"的结构性隐患,也违反 G0 自己的 fixture 脱敏纪律。
- **严重程度:** P0(安全卫生),5 分钟工作量。
- **推荐方案:** `git rm` 两者,`.gitignore` 加 `*.zip`、`**/var/data/`、`.DS_Store`;若历史中曾有密钥则需改密钥并考虑 history 清理(需要代码验证:本次仅抽查了 providers.json 头部,未逐文件核验全部入库快照)。
- **验证方式:** G0 fixture hygiene 扫描器(已存在,拒绝 secrets/绝对路径)扩展到全仓库路径而不仅是注册 fixture。

## P1-1 无 Application/Command 层,业务逻辑在 HTTP handler(→ R1)

- **问题与根因:** 590 行 `app.ts` 承载全部写路径:输入校验、版本推导(versionGroupId/version 计算)、Manifest 组装、文件写盘、SSE、提交。根因:MVP 速度优先,无 UoW 抽象。
- **风险:** 当前可用(有集成测试兜底),但 R2 的"State+Event+Receipt 同事务"没有落点——事务边界必须有一个 Command 层来持有;每个新入口(未来 /api/v1、CLI、desktop IPC)都会复制这些逻辑。
- **推荐方案:** 按 v3.0 §16 落 CommandEnvelope + Application handler + WorkspaceUnitOfWork;**不建议**提前拆 packages/ 多包发布,先用目录 + TypeScript project references + ESLint `no-restricted-imports` 分区(v3.0 §3.1 也是这么要求的)。旧路由全部变 facade。
- **涉及模块:** `server/app.ts` → `server/application/`、`server/domain/`,新增 eslint 边界规则。
- **渐进迁移:** 一条路由一条路由迁,characterization 保行为;先迁 chat/stream(最复杂、收益最大),再迁 graph/context。
- **建议阶段:** R1(本来就是 R1 的内容,此处确认无需增删)。
- **验证方式:** G1 既有门槛(dependency violation=0、OS import=0)+ 新增"route handler 中不出现 store.update 直调"的 lint 规则。

## P1-2 边界守护为正则级(→ R1)

- **问题:** 唯一的架构测试是"domain.ts 文本不含 librechat/mongoose/conversation 字样"。它挡不住任何真实违规(比如在 domain 引入 express 类型、在组件里直接 fetch DB 形状)。
- **推荐方案:** ESLint flat config 增加分区 import 规则(`server/domain/**` 禁 import express/pg/node:fs;`src/**` 禁 import `server/**` 除 contracts;`server/application/**` 禁 import express)。这一项在 R1 之前做也可以,成本一小时级,能立刻为 R1 重构护航。
- **建议阶段:** 立即~R1。
- **验证方式:** 故意提交违规 import 的 CI 红灯测试(G1 要求 dependency violation=0 的自动化前提)。

## P1-3 全量 read-modify-write 存储与单写者队列(→ R2/R7)

- **问题与根因:** 两个存储适配器都是"读全量 Workspace → structuredClone → 变异 → 全量比对写回"。进程内 `queue` 串行化意味着:多进程部署必然写丢失(Postgres 版有 FOR UPDATE 但 read() 不在同一临界区做乐观校验);写放大 O(workspace);无 per-aggregate revision,无 REVISION_CONFLICT 语义。
- **风险:** 单用户单进程下正确(当前实测 command p95≈5ms),但它是 R2(事务事实层)与一切并发能力的天花板;10k objects 的 G8 规模下每次写读全库不可行。
- **推荐方案:** 按 v3.0 §15:R2 起新写路径走 repository per aggregate + 同事务 Journal;JSON store 降级为 importer/fixture(§15.2 已规定);**不要**试图渐进优化现有 RMW(比对/差量逻辑将在 R2 整体废弃,现在优化是沉没成本)。
- **建议阶段:** R2 主体;R7 关闭旧路径。评审确认现在**不需要**动它(除 P0-1 的止血点)。
- **验证方式:** G2 既有门槛(100 并发 command 无重复/乱序 sequence、三点故障注入 half-commit=0)。

## P1-4 Planner 每轮全扫描 + 重复嵌入计算(→ R5,不提前)

- **问题:** `planContext` 每次 chat 对全部节点/段落重新 tokenize + feature-hash embedding;file chunk 已预计算(做对了)。300 节点实测 ~3ms,当前无感。
- **风险:** 规模线性恶化(10k objects 时进入几十 ms~秒级)+ 语义上无法解释"候选集来自哪个版本"。
- **推荐方案:** 维持现状到 R5;R5 落 materialized candidate index(node/segment 变更时增量更新 terms/embedding),cache key 按 v3.0 §9.3。**反对**提前做:当前数据形状(无 ResourceVersion)决定了现在建索引 R5 还要重建一次。
- **建议阶段:** R5。
- **验证方式:** G5 既有门槛(full scan=0、lookup p95≤250ms)。

## P1-5 ExecutionRun 缺失(→ R3,不提前但别再欠)

- **问题:** 失败/取消/超时的运行不留任何持久痕迹;Regenerate 无 run 谱系;TTFT/时延遥测无处落。
- **风险:** 每天 dogfood 都在流失未来 Adaptive Routing 需要的 telemetry 与 provenance 起点;但提前单独建 Run 表又会绕过尚不存在的 Journal 事务(违反 I-03)。
- **推荐方案:** 按计划 R3;唯一的"现在做"是**别新增依赖 requestId-only 的功能**(冻结期本也如此)。R3 时补 pause/resume 契约位(见 P1-7)。
- **验证方式:** G3 既有门槛。

## P1-6 多 Workspace 与最小身份缺位(→ 插入 R1 与 WP-2.1)

- **问题、风险、方案:** 见 §2.2 缺口 2。
- **建议阶段:** R1 交付"Workspace CRUD + ActorRef 落地到单本地用户"最小纵切(identity 工作包的自然内含物,但要写进 WP-1.1 验收,否则会被略过);WP-2.1 前以 ADR 决定 Beta 部署形态(自托管分发 vs 共享部署+auth)。
- **验证方式:** 新增 characterization:创建第二个 Workspace、切换、互不可见;G1 evidence 增加该 fixture。

## P1-7 Run 状态机缺 pause/resume 契约位(→ R3/ADR-007)

见 §2.2 缺口 1。成本:枚举值 + 两个 event type + ADR 一段话;不实现任何行为。

## P2-1 Gate 体系固定成本过高(→ R1 起分级)

- **问题与根因:** G1–G8 合计数百个量化门槛,大量属于故障注入/矩阵/攻击套件级别;G0 的证据基建用了约 8 个 commit 才收敛(见 git log)。根因:Gate 设计假设了一个中型团队的验收带宽。
- **风险:** 两种失败模式:(a) Gate 被认真执行,迁移速度降到价值真空期不可接受;(b) Gate 被悄悄降格执行,evidence 变成仪式。两者都比"少些 Gate"更糟。
- **推荐方案:** 把每个 G 的门槛分两级并写回 gate 文档:**阻断级**(保护不变量:半提交=0、语义事件缺失=0、历史被改写=0、stale write=0、secret 泄露=0、round-trip checksum 一致)与**观测级**(性能 p95、平台矩阵 4/4、flood 回归 ≤25% 等——记录、可红、不阻断合并,G8 时集中补齐)。绝对阈值保留,但"每个 R 全绿才能进下一个 R"只约束阻断级。
- **建议阶段:** R1 之前一次性定级(半天),否则 G1 就会遇到。
- **验证方式:** evidence manifest 增加 `severity: blocking|observational` 字段;CI 分两个 job。

## P2-2 R6 Bundle 首版范围压缩(→ R6 规划时)

- **问题:** R6 同时交付 Replay 分类、Provenance、Purge policy、完整 export/import、zip 攻击防护、clean-store round-trip——是九个批次里最重的一个,且发生在 Beta 之前。
- **推荐方案:** 保留 R6 及其全部安全门槛(zip 防护不能裁),但首版对象族收敛为 Conversation 家族(conversation/message/manifest/run/resource/graph relation),Trace segments、runtime snapshot 内嵌等选做项后移;Import-as-Fork 本来就已被排除(§13.5),确认不做。
- **建议阶段:** R6 开工前的 ADR-012。

## P2-3 前端全量 Workspace 加载与 App.tsx 集中状态(→ R4/R16 配套)

- **问题:** `GET /api/workspace` 返回全部消息/节点/manifest;App.tsx 单点持有全部状态。当前(百级节点)可用;G4 的 neighborhood API 落地时前端必须同步改为按需取数,否则 API 白做。
- **建议阶段:** R4 的 web 侧配套(路线指南 WP-1.4 已含 Graph 路径,确认包含前端消费改造即可);状态管理是否引库(zustand 等)属实现细节,不构成架构问题。

## P3-1 长期方向(只留接口/数据基础,当前不做)

- Capability Registry、Adaptive Router 评分引擎、Assignment/RunGroup 调度器、Multi-Agent Coordinator、Extension SDK/沙箱、跨 Workspace Mission、外部 Trace 后端、完整 Policy Engine——v3.0 §23 的延后清单**全部维持延后**,评审未发现任何一项需要提前。它们的接口预留(refs 字段、event type 命名空间、scope 参数)已足够。

---

# 5. 关键模块调整建议

## 5.1 `server/app.ts` → Application + HTTP facade(R1)

按 v3.0 §16.2 的映射表执行即可;补充两个实操建议:① `prepareChatRun/commitChatRun` 已经是事实上的 command handler,直接提为 `CreateConversationRun` 的第一版,不要重写;② 版本推导逻辑(versionGroupId/version 计算)迁入 domain 纯函数并补性质测试——它是当前最容易在重构中悄悄变语义的一段。

## 5.2 `server/store.ts` / `postgres-store.ts` → UoW + repositories(R2)

JSON store 按 §15.2 降级为 importer/fixture loader,不再作为生产持久化;PGlite 从 devDependency 提为 embedded backend 候选,复用同一套 StorePort contract tests(两适配器共测,v3.0 §20.1 已规定)。`deleteMissing` 与 manifest upsert 在 P0-1 止血后,整体随 R2 废弃。

## 5.3 `server/ai-runtime.ts` / `provider-runtime.ts` → RuntimeAdapter(R3)

保留事件契约,外面包 ExecutionRun 状态机;`collectRuntimeResult` 的"无 RUN_END 即异常"语义映射为 run `interrupted`。ProviderEndpoint identity 直接 backfill 自现有 provider/model UUID(不重发 ID,符合 §4.1)。遥测先落 `telemetry_summary`(TTFT、总时延、token、error class),评分引擎不做。

## 5.4 `server/context-planner.ts` → context-runtime(R5)

现有 planner 的确定性设计(feature-hash embedding、稳定 tie-break)是**测试资产**,拆分 Contributor/Index/Planner/Compiler 时保留为默认实现;真实 embedding 模型未来只是另一个 index version,不改架构。

## 5.5 Graph(R4)

`DiscussionNode.x/y` 迁出到 `graph_layout_nodes`;`DiscussionEdge` 的 relation 枚举(derived-from/references/related-to/merged-into)并入 v3.0 relation catalog(分别映射 derived_from/references/relates?/supersedes+merged 需在 ADR-010 定名)。删除语义统一 archive/tombstone/projection.removed。

## 5.6 `architecture.test.ts` + ESLint(立即)

见 P1-2。这是本报告中"性价比最高的一小时"。

---

# 6. 性能、并发、跨平台与维护成本分析

**运行效率(现状,已验证 G0 基线):** workspace query p50 1.3ms / p95 2.8ms,command p50 2.5ms / p95 5.2ms(200 样本、CI 画像)。单用户规模下没有任何性能问题;瓶颈全部是**规模外推型**(RMW 写放大、全量 Graph 传输、planner 线性扫描),都已被 G4/G5/G8 的阈值覆盖。结论:不存在需要现在优化的热点;需要的是防止"用当前规模的良好数字论证架构无问题"。

**并发:** 现状是设计上的单写者(进程内队列),这在 Phase 1 是可接受的简化;真正的并发语义(per-aggregate revision、REVISION_CONFLICT、per-workspace sequence 短临界区)由 R2 引入。注意一点:v3.0 的 workspace event head 锁会把同一 Workspace 的命令串行化——单用户无感,未来多 Agent 并行写同一 Workspace 时是已知的吞吐上界,但 trace 不走该锁,设计已考虑;无需改。

**跨平台迁移性:** 方向正确且成本低(HostRuntimePort + fake matrix + PGlite embedded + Bundle)。当前代码的 OS 耦合点少而集中(app.ts 上传写盘、store 文件路径、secret-vault 本机密钥),R1 抽端口工作量可控。Windows 路径/CRLF 风险已被 canonicalization 规则(§8.3)预先覆盖。桌面壳(Tauri/Electron)在 headless core 成立后是纯增量。

**部署灵活性:** Web/本地/自托管形态都被 headless + StorePort 覆盖;唯一缺口是 P1-6(多 Workspace/身份),它同时是共享部署的前提。

**维护成本:** 当前代码 ~5.3k 行、64 单测 + e2e,维护成本极低;真正的维护成本曲线由两件事决定——(a) Gate 体系是否分级(P2-1),(b) 包边界是否用工具而非纪律维持(P1-2)。文档维护上,v2.3(3.5k 行)与 v3.0(1.9k 行)有约 30% 语义重叠(Kernel 边界、红线、物理原则各写一遍),长期建议以 v3.0+ADR 为唯一规范源、v2.3 冻结为战略背景读物,避免双向同步成本。

---

# 7. 路线图调整建议

维持 R0→R8 的总顺序(其依赖论证成立:Journal 先于 Run、Run 先于 Graph 投影、三者先于 Manifest v1、全部先于 Bundle),做以下六项修订:

1. **R0 与 R1 之间插入"止血包"**(P0-1/P0-2/P0-3 + ESLint 边界):约 2–4 天,不改变任何 R/G 定义,把"历史流失"从持续出血变为已止血。
2. **WP-1.1(R1)范围显式追加:** 多 Workspace CRUD + 本地单用户 ActorRef 纵切(P1-6)。
3. **R3 的 ADR-007 显式裁决 pause/resume**(P1-7),并把"fencing 全套机制只对声明 `side_effects=true` 的 executor 强制,纯 LLM chat 路径允许简化恢复(重试=新 run)"写入同一 ADR——保契约、降低 G3 首轮验收面。
4. **Gate 分级**(P2-1):R1 前完成一次性定级。
5. **R6 首版对象族收敛**(P2-2)。
6. **价值真空期对策:** 路线指南已有"每个 WP 必有最小 UI/API 纵切"的规定,建议加一条硬约束——**每个 R 批次至少发布一个用户可感知的改进**(R2:历史时间线视图;R3:运行状态/失败可解释 UI;R4:neighborhood 加载与大图流畅度;R5:Context 解释面板;R6:导出按钮)。这些本来就在各 WP 交付里,提级为验收项可防止"只落表不落产品"的漂移(路线指南 §24 自己也把它列为头号风险)。

**明确不建议的调整:** 不建议为了赶产品而跳过 R2 直接做 R3(Run 终态写入没有事务事实层就是又一批将来要迁的孤儿数据);不建议把 R4 Graph 提到 R3 前(v2.3 §15 已论证过顺序);不建议在 Phase 1 引入任何被 §23 延后的平台组件。

---

# 8. 推荐的长期目标架构

**结论:v3.0 第 3 章的目标架构即为推荐架构,无需另起炉灶。** 长期形态收敛为:

```text
Clients (Web / Desktop Host / CLI / 未来 IPC)
        ↓ 稳定 Protocol(/api/v1 + contracts schema)
Application Commands & Queries(唯一写入口,CommandEnvelope + UoW)
        ↓
Domain(纯模型 + 不变量)…… 稳定内核协议八件套:
  ObjectRef/Scope · Event Envelope+Catalog · ExecutionRun · ContextManifest
  ResourceVersion/Blob · StorePort · RuntimeAdapter · HostRuntimePort
        ↓
单 PostgreSQL 实例内逻辑分区:
  transactional_* │ workspace_events │ execution_runs │ execution_traces(分区+retention)
  context_manifests(不可变) │ resource_* │ projection_* + checkpoints │ command_receipts
        +
content-addressed BlobStore · bounded Transient Stream · workspace.rhiza Bundle
```

其上的可替换层(LLM/Planner/Retriever/Agent loop/Tool/Sandbox/UI view/Extension/Execution provider)全部通过上述八个协议接入;Adaptive Router、Coordinator、Extension Runtime 作为协议消费者而非内核成员加入。**判定长期健康的三个信号:** 新对象族(Task/Artifact)只新增 object/relation/event type;新执行方式只新增 RuntimeAdapter;新智能层(路由/记忆/影响分析)只读 Journal/Trace/Telemetry 并写自己的 Projection。任何一次演进要求修改八件套之一的语义,都必须走 ADR + 新 major schema,这就是"架构摩擦最小化"的操作定义。

---

# 9. 行动优先级总表

## 立即处理(R0 收尾 ~ R1 开工前,合计约一周内)

| 项 | 内容 | 出处 |
| --- | --- | --- |
| A1 | 止血:节点删除默认 archive;manifest upsert 去 DO UPDATE;deleteMissing 停用于 manifests/messages;登记为有意语义变更 | P0-1 |
| A2 | 写 ADR-002/003/004/005(建 `docs/adr/`) | P0-2 |
| A3 | 移除入库 zip 与 var/data 快照,补 .gitignore,全仓库跑一次 secret 扫描 | P0-3 |
| A4 | ESLint 分区边界规则替换正则测试 | P1-2 |
| A5 | 文档修正:librechat-migration.md 标 superseded;archive/* 加头注;architecture.md M2 表述更新;Gate 分级决定(P2-1)写入 gates README | §1.2, P2-1 |
| A6 | 修复 G0 API snapshot 提取器:路由提取正则仅匹配 `get\|post\|patch\|delete`,漏记 `PUT /api/providers/:id`(实际 25 条路由,`api.json` 只有 24 条),快照与 checksum 需重生成 | 附录 §10 |

## 当前 Phase 内、按既定 Milestone 处理

| 项 | 内容 | 批次 |
| --- | --- | --- |
| B1 | Application Command 层 + UoW,路由变 facade | R1 |
| B2 | 多 Workspace CRUD + ActorRef 最小纵切(新增进 WP-1.1) | R1 |
| B3 | State+Journal+Receipt 同事务;JSON store 降级 | R2 |
| B4 | ExecutionRun + Endpoint identity + telemetry;ADR-007 裁决 pause/resume 契约位与 fencing 适用范围 | R3 |
| B5 | Graph 投影化 + layout 分离 + neighborhood API + 前端按需取数 | R4 |
| B6 | Context 候选索引 + Manifest v1 + 不可变 DB 防护 | R5 |
| B7 | Beta 部署形态 ADR(自托管 vs 共享+auth) | WP-2.1 前 |

## 下一 Phase(R6~Step 2)

- R6 Bundle 首版收敛为 Conversation 对象族(P2-2);Purge/加密 blob 按 I-04 全量保留。
- 观测级 Gate 项在 G8 集中补齐至阻断级。
- Legacy 写路径关闭(R7)后再讨论旧表清理,不提前。

## 长期演进(只留接口/数据基础)

- Adaptive Router 评分引擎、ObservedCapabilityProfile 聚合、Route Fingerprint(数据基础 = R3 的 per-run telemetry,已安排)。
- Multi-Agent Coordinator、Assignment/RunGroup 调度、Handoff(seam = Run 的三个 ref 字段,已安排)。
- Extension Runtime/SDK、Context Graph/长期记忆(seam = contributor 接口 + scope 化 cache key,已安排)。
- 跨 Workspace Mission、桌面壳、多进程部署。

## 理论上可优化、现阶段明确不建议

- 全量 Event Sourcing / CQRS 读写分离 / Actor Model / 分布式事件总线 / Kafka——v3.0 已拒绝,评审维持。
- 图数据库(Neo4j 等):10k/50k 规模下 PostgreSQL 邻接表 + 索引完全够用,引入代价是 Bundle/迁移/测试三处翻倍。
- 专用 trace 后端(ClickHouse/OTel collector):G3 的分区表 + retention 足够,超过百万级 trace/日再议。
- CRDT / 实时多端同步:Phase 1–2 无此需求,Bundle 已覆盖迁移场景。
- 提前拆 packages/ 独立发布包:目录 + project references + lint 即可,发布包等 Extension SDK 有真实外部消费者再做。
- 微服务/多数据库:无任何当前收益。
- WorkspaceSnapshot 加速机制(v3.0 §5.7):在 Phase 1 事件量级(千级/workspace)下重放成本可忽略,建议 G2 将其从阻断项降为观测项,数据基础(source_sequence 语义)保留。

---

# 10. 附:核查状态说明

**已代码验证:** §2.1 表格全部十项;G0 evidence/基线数字;planner 复杂度与实测;存储适配器行为;Runtime 契约;边界测试内容;ADR 缺失;单 Workspace 单例;pause/resume 在 v3.0 全文缺失;zip/var-data 入库。

**已代码验证(补充,经独立代码核查子任务复核):** G0 `api.json` 快照漏记 PUT 路由(提取正则缺陷,见 A6);`libreChatRuntime`/`fileContext` 两个 feature flag 已定义但无任何消费分支(仅 `postgresPersistence` 被 `index.ts` 使用);`vendor/librechat-runtime/` 目前仅含 README;入库的 `Rhiza-Dev-*` 目录不含源码,仅运行时数据快照;e2e 覆盖 provider SSE/Stop 不落库、PGlite 三迁移正反向、1000+ 事件顺序恢复与真库幂等迁移;全仓库共 16 个测试文件、约 69 个用例。

**需要代码验证(本次未逐项核实):**

1. `.github/workflows/ci.yml` 的实际门禁范围与 G0 observe job 的运行状态(仅确认文件存在)。
2. `codex/rhiza-librechat-runtime` 与 `codex/r0-g0` 远程分支的内容及其与 main 的关系(librechat-migration.md 所述 `librechat-v0.8.7` 基线分支未见于当前 remote 列表,需确认是否在别处托管)。
3. 入库运行时快照文件的完整内容是否含任何敏感数据(仅抽查了 providers.json 头部)。
4. M1 验收所述 UI 能力(Reasoning/Tool Call/Usage 展示等)在前端组件中的完整度(仅核对了后端契约存在)。

本报告若与 v3.0 冲突,除 P0/P1 各项与 §7 的六条路线修订外,以 v3.0 为准;上述修订建议通过新增 ADR 的方式并入基线,而不是直接改写 v3.0 正文。
