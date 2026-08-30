# Rhiza 开发路线图

```text
Version: V4.2
Release Date: 2026-08-29
Baseline: Rhiza Architecture & Roadmap Baseline V4.2
Status: Proposed
Supersedes: V4.1 after merge
```

> V4.2 是 V4.1 的最小路线修订。
> 核心决策：**Chat first, Workflow second；不并行开发两条主线。**
> M01–M03 已完成，不返工。路线调整从 M04 开始。

---

# 1. V4.2 变更摘要

V4.2 只修改以下内容：

1. M01–M03 冻结为已完成，不因新产品认识重新开发；
2. M04 延后 spawn / cross-platform host 等 Workflow/Desktop 专属实现；
3. M06 聚焦 Chat 所需 ExecutionRun，Assignment/RunGroup/pause-resume/完整 side-effect fencing 后移；
4. M11 从“证明所有未来能力都兼容”收敛为 Chat-era Architecture Convergence；
5. M16 加入 Model Collaboration v1，多模型讨论在 Chat 完成前进入产品；
6. M20 吸收 Complex Task Workspace 的静态 TaskPlan/Workstream 基础；
7. M24 从 Coding Agent 改为通用 External Executor / Agent Harness；
8. Workflow 从原 M27 前移到 M25，但严格在 M17 Chat Product Complete 后开发；
9. M26 为 Multi-Agent，M27 为 Full Auto & Workflow Quality；
10. Adaptive Routing v2 移到 M28；Desktop 移到 M29；
11. M30–M32 保持 Memory / Plugin / Control Plane。

未列出的 V4.1 目标、验收原则、数据安全与架构不变量保持不变。

---

# 2. 当前开发事实与 M01–M03 处理

## 2.1 Linear 状态

```text
M01 100%
M02 100%
M03 100%
M04 0%
```

M03 的 Schema、Identity、Scope、scoped API、Workspace Product UI、Recovery、Gate issues 均已完成。

## 2.2 GitHub 状态

当前 M03 开发分支 `codex/m03-m04` 相对 `main`：

```text
ahead 36 commits
behind 0
```

分支包含：

- identity/workspace migration；
- Workspace scope enforcement；
- scoped API；
- Workspace UI；
- M03 evidence；
- boundary repair。

因此 V4.2 的裁决是：

> **不重新开发 M01–M03。**

M04 开工前只做一次 Integration Check：

```text
merge/rebase M03 branch
↓
CI
↓
verify M01/M02/M03 evidence
↓
确认无 V4.2 contract break
↓
进入 M04
```

若发现问题，按 bug / integration issue 修复，不重新打开整个 Milestone。

---

# 3. 总体路线

```text
Stage 1 — Chat-era Architecture Convergence
  M01–M11

Stage 2 — Chat Product
  M12–M17

Stage 3 — Chat Differentiation & Shared Capabilities
  M18–M24

Stage 4 — Automation Workflow
  M25–M27

Stage 5 — Long-term Optimization & Platform
  M28–M32
```

Chat 主线在 M17 前严格串行收敛；M17 后共享能力按真实依赖分支推进：

```text
M01 → ... → M11
      ↓
M12 → ... → M17   Chat Product Complete
                  │
                  ├─ M18 → M19 ─┬→ M20 ─┐
                  │             └→ M21 ─┴→ M22 ─┐
                  │                              │
                  └─ M23 → M24 ─────────────────┤
                                                 ↓
                                                M25 Workflow v1
                                                 ↓
                                                M26 Multi-Agent
                                                 ↓
                                                M27 Full Auto / Quality
```

禁止为了 M25+ 提前占用当前 Chat 主线开发资源。M18–M24 允许按依赖局部并行，但不允许 M25 Workflow Runtime 与 M12–M17 并行开发。

---

# 4. Stage 1 — Chat-era Architecture Convergence

## M01 — 止血与基线治理

**状态：Done / 保持 V4.1 原样。**

不重新开发。

## M02 — Application 层与模块边界

**状态：Done / 保持 V4.1 原样。**

不重新开发。

## M03 — Multi-Workspace 与最小 Identity

**状态：Done / 实现完成，待正常集成 main。**

V4.2 不新增 schema redesign。

Blocking Acceptance 继续沿用已通过 evidence：

- cross-workspace read/write = 0；
- ActorRef/ScopeRef missing write = 0；
- backfill checksum 幂等；
- Workspace full flow；
- Legacy compatibility。

---

## M04 — Resource、Blob 与最小 Host Runtime Port

**Priority：P0**

### 保留

- Resource / ResourceVersion；
- digest；
- content-addressed Blob；
- temp → verify → atomic promote → DB commit；
- attachment backfill；
- orphan GC；
- Node/headless current Host adapter。

### V4.2 延后

不在 M04 实现：

- spawn / PTY；
- process supervision；
- Windows/macOS/Linux 完整 capability fake matrix；
- DesktopHostAdapter。

这些分别进入 M24 / M29。

### Blocking Acceptance

- committed dangling blob refs = 0；
- attachment backfill checksum 幂等；
- digest corruption silent fallback = 0；
- Domain/Application OS direct import = 0；
- current server host contract suite green。

---

## M05 — Domain Journal 与事务事实层

**保持 V4.1 原样。**

目标仍是：

- Event Envelope；
- CommandReceipt；
- State + Event + Receipt same transaction；
- per-workspace sequence；
- append-only protection；
- embedded transactional backend；
- shadow write/reconcile；
- Workspace activity timeline。

不增加 workflow.* event catalog。

---

## M06 — ExecutionRun 与 Chat 执行历史

**Priority：P0**

### 目标

让当前 Chat 的每次模型调用拥有 durable、explainable terminal state。

### 必须实现

- execution_runs；
- immutable ContextEnvelope；
- ModelSpec × ProviderEndpoint identity；
- server-side cancel；
- retry/regenerate parent lineage；
- crash reconciliation；
- trace / transient stream；
- telemetry summary；
- error taxonomy；
- Run UI。

### 延后到 M24–M26

- Assignment；
- RunGroup；
- pause/resume behavior；
- Multi-Agent handoff；
- 完整 side-effect fencing。

允许保留零成本 metadata seam；不得为了 seam 扩大 M06 状态机。

### Blocking Acceptance

- external LLM calls terminal tracking = 100%；
- cancel/late-result race coverage = 100%；
- retry/regenerate 不覆盖旧 Run；
- 10k trace 不污染 Domain Journal；
- restart 后 UI/Run 状态最终收敛。

---

## M07 — Workspace Graph Projection v1

V4.1 `Universal Work Graph Projection` 的核心设计保留，但验收聚焦当前真实对象：

```text
Conversation / Message / Resource / Run / Relation
```

保留：

- ObjectRef；
- relation catalog；
- layout projection；
- incremental projector；
- bounded API；
- clean rebuild；
- archive/tombstone/retract/remove。

Task/Artifact future fixture 不再作为 Blocking Acceptance。

---

## M08 — Context Runtime v1

**保持 V4.1 原样。**

Contributor / CandidateIndex / Planner / Compiler / immutable Manifest v1。

不提前实现 embedding / Memory。

---

## M09 — Replay、Provenance 与 Portable Bundle v1

**保持 V4.1 原样。**

这是 Chat 与未来 Workflow 的共同基础，不延后。

---

## M10 — Legacy 写路径关闭

**保持 V4.1 原样。**

关闭 mutable snapshot/deleteMissing/旧 cascade 等 legacy truth path。

---

## M11 — Chat-era Architecture Convergence v1

**Priority：P1**

### V4.2 目标

证明 M01–M10 足以支撑可靠、可演进的 Chat / Graph / Context 产品。

M11 完成后的语义：

```text
Chat-era Kernel v1 stable
```

而不是“所有未来 Workflow / Plugin / Multi-Agent contract 永远无需修改”。

### Blocking

- M01–M10 evidence audit；
- snapshot + tail replay / consistency；
- Command performance；
- Graph large fixture；
- Context lookup；
- trace flood；
- Bundle round trip；
- current Host adapter；
- real dogfood。

### Observational only

低成本验证：

- Task additive object seam；
- External side-effect executor seam；
- WorkflowDefinition / WorkflowRun additive seam。

### 删除的 Blocking Spikes

不再要求：

- Extension sandbox spike；
- Multi-Agent RunGroup/handoff spike；
- Adaptive capability learning spike；
- Full Auto / authority evolution spike。

失败的 observational seam 记录为 M20/M24/M25 ADR 输入，不阻断 Chat。

---

# 5. Stage 2 — Chat Product（M12–M17）

目标：**先让 Rhiza 成为真正可长期使用的 Chat Workspace。**

---

## M12 — Chat 核心体验完备

**保持 V4.1 原样。**

- Stop；
- stream / retry / regenerate / edit-resend；
- temp branch；
- conversation model；
- offline/reconnect；
- error recovery；
- run lineage。

---

## M13 — Conversation 与 Multi-Workspace 管理产品化

**保持 V4.1 原样。**

---

## M14 — Graph 产品化

**保持 V4.1 原样。**

---

## M15 — Context 产品化

**保持 V4.1 原样。**

Auto / Assisted / Strict、Resource UX、Manifest、Replay、Provenance UI。

---

## M16 — 多模型协作、设置与数据可靠性

**Priority：P0/P1**

V4.1 的设置、导入导出、备份、安全扫描全部保留。

V4.2 在同一 Milestone 增加 **Model Collaboration v1**，避免新增 Milestone 和大规模重编号。

### A. Model Collaboration v1

底层只实现：

```text
invoke
exchange
synthesize
```

产品首批能力：

- Independent Review；
- Peer Review；
- Debate；
- Second Opinion。

### 行为要求

- 第一轮独立输出默认互不可见；
- 所有参与模型使用明确记录的 Context base；
- Exchange 轮次显式；
- 用户可设置最大轮数、模型、Token/时间预算；
- synthesis 给明确推荐，不只罗列观点；
- 主要替代方案、优缺点、风险、适用条件与推荐理由必须可见；
- 每个输出可追到 ExecutionRun / ContextManifest / model / endpoint；
- 任何 collaboration 可停止，不影响普通 Chat。

### B. V4.1 Operability

继续完成：

- Bundle UX；
- backup/restore；
- Provider settings；
- secret/path scanning；
- operator guide。

### Non-goals

不做：

- Debate state machine；
- Argument graph；
- 自动 personality learning；
- 自动为每次对话强制多模型调用。

---

## M17 — 稳定性验收与 Daily Replacement Matrix

**保持 V4.1 的核心验收。**

新增一项非强制使用但必须可用的 Chat 能力验证：

- Model Collaboration 不得破坏普通单模型 Chat；
- 至少完成固定 Independent Review / Debate / Second Opinion / Synthesis 测试集；
- 用户可以明确控制是否投入额外 Token。

### 验收执行顺序

```text
M12–M16 Product Gates
        ↓
冻结 Daily Replacement Acceptance Matrix
        ↓
Functional/UX  |  Recovery/Data  |  Performance/Stability  |  Real-use
        ↓
Final Go / No-Go Gate
```

Matrix 必须在验收开始前冻结，禁止测试后放宽阈值。四类 evidence 可以并行收集，但不能互相替代：长期 dogfood 不能替代新用户测试，内部 demo 不能替代真实恢复/性能证据。Final Gate 只在全部阻断项完成后输出 Go/No-Go、残余风险与下一阶段解锁决定。

M17 通过后：

```text
Chat + Graph + Context Product Complete
```

只有此后才能开始 M18+ 主线。

---

# 6. Stage 3 — Chat Differentiation & Shared Capabilities（M18–M24）

本阶段所有能力要么直接增强 Chat/Workspace，要么是未来 Workflow 必需的共享基础。

M17 通过后按真实依赖局部并行推进；不与 M12–M17 并行。M20 与 M21 可在 M19 后并行，M22 汇合 M20+M21；M23→M24 是独立 Execution 支线。

---

## M18 — UI / 信息架构升级与 Graph UX v2

保持 V4.1。

---

## M19 — Workspace State 与 Artifact / Knowledge / Decision

保持 V4.1。

---

## M20 — Task 对象与 Complex Task Workspace 基础

在 V4.1 M20 基础上**吸收原 M26 的静态 Complex Task Workspace 基础**，删除一个重复里程碑。

### 目标

- Goal / Task 一等对象；
- TaskPlan revision；
- blocked_by / depends_on；
- Task Graph View；
- Workstream；
- per-task Context Packet ref；
- static Plan / Task mapping。

### 非目标

M20 不执行 Workflow Runtime：

```text
Loop
Gate
Condition
Parallel scheduler
Full Auto
```

其中 Workflow v1 的最小 Loop / Gate / bounded Parallel 在 M25 落地；generic Condition 作为 v1.x 候选保留，不作为 M25 v1 完成条件。

### 完成标准

至少一个真实复杂任务可以用 Task/Workstream 全程组织，但执行仍可人工触发。

---

## M21 — Search 与 Resource 管理

保持 V4.1。

---

## M22 — Context Planner v2 / Context Intelligence v0

保持 V4.1 功能范围。前置调整为 **M20 Task/Complex Task foundation + M21 Search/Resource foundation**，两者均基于 M19；M22 不再反向阻塞 M20。

---

## M23 — Execution Observability 与基础 Routing Assistance

保留 V4.1 的 Run 时间线、成本/延迟/error、Endpoint profile、manual recommendation/fallback。

明确：

```text
不做自动路由
不做 Personal Capability Model
不作为 M25 Workflow 的前置智能决策
```

Workflow v1 可完全使用用户静态角色映射。

---

## M24 — External Executor / Agent Harness v1

**原名：外部 CLI / Coding Agent 最小接入。**

### 改名理由

Rhiza Workflow 是通用工作流，不只服务 coding。

### 首个实现

仍允许选择一个 Coding Agent / CLI 作为 PoC，但 contract 是通用 Executor。

### 实现

- RuntimeAdapter；
- HostRuntimePort spawn；
- scoped inputs；
- approval；
- effect provenance；
- side-effect fencing；
- crash reconciliation；
- capability descriptor；
- disable fallback。

### Blocking Acceptance

- unauthorized spawn = 0；
- effect provenance coverage = 100%；
- stale attempt effect = 0；
- adapter crash 不破坏 Workspace truth；
- 禁用 external executor 后 Chat 完整可用。

M24 Gate **只直接解锁 M25 Automation Workflow v1**。M26 Multi-Agent 必须在 M25 Gate 通过后进入；M24 对 M26 是间接前置，不得绕过 Workflow 主链。

---

# 7. Stage 4 — Automation Workflow（M25–M27）

此阶段在 Chat 产品和共享能力完成后才开始。

---

## M25 — Automation Workflow v1

**Priority：P0**

吸收 V4.1 原 M26 Complex Task Workspace 剩余内容与原 M27 Workflow Orchestration 的最小必要部分。

### 产品闭环

```text
Goal
 ↓
Plan
 ↓
Dispatch
 ↓
Execute
 ↓
Evaluate
 ↓
Pass? ─ Yes → Deliver
  │
  No
  ↓
Revise / Replan
  ↓
Execute
```

旁路：

```text
Executor → Consult → specialist model → resume
```

### v1 必须支持

- versioned WorkflowDefinition / WorkflowRun；
- Task mapping；
- Sequence；
- bounded Parallel；
- Evaluate / Gate；
- reject → rework loop；
- explicit user approval seam；
- Consult；
- crash recovery / idempotent transition；
- timeline（由持久 WorkflowRun state + Domain Journal 解释/重建）；
- Manual / Assisted mode。

### v1 暂不要求

**Deferred, not deleted：**

- generic Condition 节点；
- ForEach 泛化；
- SubWorkflow；
- richer HumanApproval node。

M25 v1 先用 Evaluate/Gate + explicit approval seam 覆盖真实需求；只有 dogfood/workflow 明确需要时，以上能力才以 v1.x additive capability 进入开发。

明确不做：

- 通用 Policy Engine；
- continuous supervisor；
- automatic authority learning。

### Gate 语义

```text
PASS
REJECT
BLOCKED
```

`BLOCKED` 先尝试系统内部 resolve；只有无法消解时才升级用户。

### Completion

Workflow 只有满足 acceptance / quality criteria 才算 completed。

### Kernel Review

M25 完成时执行 Workflow Compatibility Review。若真实需求证明 Kernel contract 不足，允许 ADR + additive/major schema 调整；禁止为了“保持零 Kernel 改动”而绕出更复杂系统。

---

## M26 — Multi-Agent Orchestration v1

**Priority：P1｜Stage 4 正式里程碑**

仅在 **M25 Automation Workflow v1 Gate 通过后**进入。M24 External Executor 是 M25 的间接前置，不单独解锁 M26。

在 M25 单/多节点 Workflow 稳定后增加多 Executor：

- Assignment；
- RunGroup；
- parallel；
- retry / reassign；
- independent cancel；
- pause/resume when supported；
- handoff；
- human takeover；
- per-Assignment permission/capability + privilege-escalation negative cases；
- conflict reconciliation；
- trajectory。

Multi-Agent 不是 AI hierarchy。

Role 是 Workflow-level：

```text
planner
executor
reviewer
tester
researcher
...
```

具体模型动态或静态绑定。

---

## M27 — Full Auto & Workflow Quality v1

**Priority：P0/P1｜Stage 4 正式里程碑**

仅在 **M26 Multi-Agent Gate 通过且已有真实 Workflow 运行数据后**进入。

### 目标

让用户可以只提供目标和关键约束，Rhiza 在授权范围内自主推进到成品，而不是把专业判断重新推给用户。

### 最小机制

- strong initial planning；
- optional multi-model decision for high-value planning；
- acceptance criteria；
- objective tests/evaluators；
- independent review where useful；
- revise/replan loop；
- Consult；
- user escalation boundary；
- resource/quality strategy。

### Full Auto 升级用户的条件

仅限：

- goal change；
- value trade-off；
- major irreversible risk；
- unresolved critical conflict；
- explicit user-required approval。

### 必须给推荐

当存在多个可行策略时，Rhiza 必须：

- 给推荐方案；
- 给主要替代方案；
- 说明优缺点；
- 风险；
- 适用条件；
- 推荐理由。

### Non-goals

不实现：

- Delegated Authority System；
- Authority State Machine；
- Policy Compiler；
- Semantic Effect Inspector；
- Three Lines Runtime。

这些只有在真实 Full Auto failure data 证明简单机制不足后才重新评估。

---

# 8. Stage 5 — Long-term Optimization & Platform（M28–M32）

---

## M28 — Adaptive Routing v2 / Personal Capability Model

**由 V4.1 M29 前移一位。**

启动条件保持严格：

- M23 Endpoint 画像经过 **≥3 个月真实使用观察**，有足够真实 telemetry 且与用户主观体验基本一致；
- Workflow/Multi-Agent 产生任务条件与 outcome；
- score 必须有 sample/window/confidence；
- Manual/Pinned/static mapping 永远可用。

质量目标优先，不以最低成本为唯一目标。

---

## M29 — Desktop / 跨平台 Host 与可移植性强化

**由 V4.1 M25 后移。**

原因：Desktop 对 Chat/Workflow 都有价值，但不应抢占 Chat 产品和 Workflow 核心闭环。

此时再实现：

- DesktopHostAdapter；
- Windows/macOS/Linux packaging；
- embedded default；
- backup；
- multi-workspace export；
- 真实 cross-platform capability matrix。

---

## M30 — Context / Memory Intelligence

保持 V4.1 候选定位。

依然要求真实需求/实验支持，不提前实现 Mind、复杂 Typed Memory 或自动 semantic merge。启动评审必须同时具备 M19 Knowledge、M22 Context Intelligence，以及 M20 Complex Task + M25 Workflow 的真实长期记忆需求证据。

---

## M31 — Plugin Ecosystem / Extension Registry

保持 V4.1 候选定位。先在 M31 内完成 internal extension v0 + 至少两个 first-party extension dogfood，再决定是否公开 SDK / Registry；依赖 M24/M26 的真实 scope/permission 证据，**不依赖 M29 Desktop**。

公开生态继续保留 V4.1 已定义的治理能力：安装/升级 **permission diff**、extension **version pin**、Registry **publisher identity** 与版本/包撤回治理、卸载数据处置；恶意/损坏包拒绝、签名校验、沙箱逃逸测试与 Registry 不可用降级均为未来实现的硬验收方向。

---

## M32 — Mission / Control & Observability Plane

保持 V4.1 长期方向。

依赖 Workflow / Multi-Agent / Routing / Plugin 有真实稳定证据。

---

# 9. 新依赖关系

```text
M01 → M02 → M03 → M04 → M05 → M06 → M07 → M08 → M09 → M10 → M11
                                                              ↓
M12 → M13 → M14 → M15 → M16 → M17  Chat Product Complete
                                      │
                                      ├─ M18 → M19 ─┬→ M20 ─┐
                                      │             └→ M21 ─┴→ M22 ─┐
                                      │                              │
                                      └─ M23 → M24 ─────────────────┤
                                                                     ↓
                                                                    M25 → M26 → M27

M28 ← M23 telemetry + M25/M26 outcome data
M29 ← M17（Desktop 长期分支，无 Workflow/Plugin 硬依赖）
M30 ← M19 + M22 + M20/M25 的真实需求证据
M31 ← M24 + M26 → first-party extension validation → public SDK/Registry
M32 ← M25 + M26 + M28 + M31
```

M18–M24 可以在 M17 后按 dependency 局部并行开发；编号表示路线位置，不再强制 M18–M24 全串行。**M25 Workflow 不得与 M12–M17 Chat Product 并行开发。**

具体并行边界：M20 与 M21 可在 M19 后并行；M22 依赖 M20 + M21；M23 直接依赖 M17，M24 依赖 M23，因此 Execution 支线可以与 M18–M22 并行。M31 Plugin 不依赖 M29 Desktop。

---

# 10. V4.1 → V4.2 Milestone 映射

| V4.1 | V4.2 | 处理 |
| --- | --- | --- |
| M01 | M01 | Done，不变 |
| M02 | M02 | Done，不变 |
| M03 | M03 | Done，不变 |
| M04 | M04 | 缩小 Host scope |
| M05 | M05 | 不变 |
| M06 | M06 | Workflow-only states 后移 |
| M07 | M07 | future fixtures 降为非阻断 |
| M08 | M08 | 不变 |
| M09 | M09 | 不变 |
| M10 | M10 | 不变 |
| M11 | M11 | Chat-era convergence；未来 spike 降级 |
| M12–M15 | M12–M15 | 不变 |
| M16 | M16 | 新增 Model Collaboration v1 |
| M17 | M17 | 不变，增加 collaboration compatibility |
| M18–M19 | M18–M19 | 不变 |
| M20 | M20 | 吸收原 M26 static Complex Task |
| M21–M23 | M21–M23 | 不变 |
| M24 | M24 | 通用 External Executor |
| M25 Desktop | M29 | 后移 |
| M26 Complex Task | M20/M25 | 合并，不再独立 |
| M27 Workflow | M25 | 前移并收敛 |
| M28 Multi-Agent | M26 | 前移 |
| 新增 | M27 | Full Auto & Workflow Quality |
| M29 Adaptive Routing | M28 | 前移一位 |
| M30 Memory | M30 | 不变 |
| M31 Plugin | M31 | 不变 |
| M32 Control Plane | M32 | 不变 |

---

# 11. M03 前是否需要返工：正式结论

**No.**

理由：

1. M01 的历史止血、ADR、边界/evidence 治理仍是 V4.2 必需；
2. M02 Application boundary 恰好支撑 Chat Application 与未来 Workflow Application 的独立演进；
3. M03 Workspace/Identity/Scope 是两个一级产品系统的共同所有权基础；
4. V4.2 没有引入要求修改 M01–M03 核心 contract 的新概念；
5. Linear M01–M03 evidence 已完成；
6. M03 当前开发分支已经形成完整实现与 gate evidence。

因此：

```text
M01–M03 = Frozen Completed Baseline
```

若 V4.2 后续需要新增字段：

```text
additive migration
new event/object/relation type
new application module
```

而不是重做旧 Milestone。

---

# 12. 开发纪律

1. Chat Product Complete 前，不启动 Workflow Runtime 开发。
2. 对 Chat 有直接价值的多模型协作可以前移，但只做通用 `invoke / exchange / synthesize`。
3. 只服务 Workflow 的 Assignment/RunGroup/pause-resume/spawn/fencing 等后移。
4. Workflow 先做最小质量闭环，再 Multi-Agent，再 Full Auto。
5. Adaptive Routing 不是 Workflow 前置条件。
6. 每一个新复杂机制必须由更简单方案的真实失败获得开发资格。
7. 不因为 V4.2 再次做一次大架构重构；V4.2 的主要工作是删前置复杂度、重排应用层路线。
