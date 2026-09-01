# Rhiza AI 可派发开发任务规划 V1.1

> 日期：2026-09-02  
> 适用项目：Rhiza Roadmap V4.2  
> 性质：开发执行规划 / Linear 写回草案
> 复审：2026-09-02 二次工程可派发性审计（依赖、边界、验收、UI 视觉验证）  
> 状态：**尚未写入 Linear**  
> Source of Truth：Linear 负责工程 WBS 与依赖；Git repository 负责实现事实；本文是二者之间的可执行规划草案。

---

## 0. 文档目的

本文讨论的是**如何开发 Rhiza 以及同类复杂软件项目**，不是重新设计 Rhiza 产品架构。

目标是把现有 Linear Roadmap 调整为一种可以稳定支持以下命令的工程结构：

```text
完成 INH-59
完成 WU-M07-B2
完成 M07
```

这些命令的含义分别是：

- `完成 Issue`：将一个边界明确、可独立测试的工程切片交给满足最低能力要求的一个主模型；
- `完成 WU`：将若干完整 Linear Issues 按同一模型能力等级、相邻代码上下文与稳定依赖打包，按既定顺序由同一模型完成；
- `完成 Milestone`：把该 Milestone 的 Issue DAG 解析为多个受控 execution runs；可以固定使用同一高等级模型，但**不要求一个连续 agent session 从头运行到尾**。

本文遵循一个保守原则：

> **任务分解质量比 dispatcher 智能程度更重要。**

不预设“一个 Agent 可以连续自主工作数周”，不假设后续实现永远不会暴露上游设计错误，也不把 WU 发展为第二套 Workflow 系统。

---

## 1. 当前 Linear 基线

截至 2026-09-02，Linear 项目 `Rhiza Roadmap V4.2` 的事实状态为：

- M01–M05：Done；
- M06：下一主线 Milestone；
- M07–M17：Chat 主线；
- M18–M24：M17 后进入的共享能力与 Workflow 基础；
- M25 → M26 → M27：Workflow → Multi-Agent → Full Auto，串行推进；
- M28–M32：长期优化或候选能力，按启动条件进入。

项目纪律保持不变：

```text
M01 → M02 → M03 → M04 → M05
→ M06 → M07 → M08 → M09 → M10 → M11
→ M12 → M13 → M14 → M15 → M16 → M17
```

M17 后：

```text
Work/Context:
M18 → M19 → {M20, M21} → M22

Execution:
M23 → M24

汇合:
M20 + M22 + M24 → M25 → M26 → M27
```

本文**不重开 M01–M05**，只把它们视为当前 repository baseline 和历史 evidence。

---

# 2. AI-Ready Engineering 规则

## 2.1 Linear Issue 是最小正式工程 WBS 单位

一个处于 Active/Backlog、可直接施工的 Linear Issue 必须满足：

1. 一个主要工程目标；
2. 一个主要认知/模型能力等级；
3. 一个可枚举的修改范围；
4. 所有关键上游 contract 在开始前已接受；
5. 不依赖未来 Issue 才能完成自己的 unit acceptance；
6. 可以自然形成一个 coherent PR/commit set；
7. 有明确测试、fixture、benchmark 或可复核 evidence；
8. 遇到需要修改已接受上游 contract 的情况时，必须显式停止并进入 change-control。

不要求 Issue：

- 与其他模块完全无关；
- 没有历史依赖；
- 未来永不返工；
- 一次上下文窗口内完成。

要求的是：

> **在当前已接受 baseline 上，它可以由一个满足最低能力等级的主代理独立开发、测试并提交可验收结果。**

---

## 2.2 Issue 尺寸上限：一个 coherent engineering change

不要用“预计 X 小时”作为唯一拆分标准。

出现以下任一情况时，应优先拆 Issue：

- 同时修改多个相对独立 subsystem；
- 同时包含未冻结的 ADR 决策和大量机械实现；
- 包含多个可以独立提交/回滚的纵切；
- 测试反馈周期很长，局部失败难定位；
- 一个模型必须在过程中多次切换完全不同的认知模式；
- Issue 描述中出现大量“独立工作包”，且这些工作包可以独立验收。

---

## 2.3 模型能力等级

不追求 L1–L5 的虚假精确性；调度层先使用三档，必要时在 A 档内部再人工选择更强模型。

| Tier | 对应 | 适用范围 |
|---|---|---|
| **A · SOTA** | 约 L4–L5 | 高 blast-radius contract、并发/恢复、安全、不可逆迁移、跨模块语义、新机制收敛、复杂 root-cause |
| **B · Strong** | 约 L2–L3 | 已冻结 contract 内的模块实现、API/UI、迁移实现、普通恢复、性能实现、集成、测试 |
| **C · Fast** | 约 L1 | 机械 glue、文档、fixture 生成、确定性 UI wiring、简单测试补齐、无开放决策空间的清理 |
| **H · External** | 非模型等级 | 真实用户、观察窗、真机/外部环境或必须由人类完成的 evidence |

原则：

> 技术复杂 ≠ 必须 A；只要 contract 已冻结、失败可测试，复杂实现也可由 B 完成。  
> 代码量少 ≠ 可以 C；只要它决定高成本长期语义，就应升级到 A。

---

## 2.4 Contract Freeze 的实际含义

`Frozen` 不等于永不修改。

它表示：

> **下游任务不得未经显式 change-control 隐式修改已经 accepted 的上游 contract。**

如果下游发现设计缺陷，应返回：

```text
CONTRACT_CHANGE_REQUIRED

Affected contract:
Reason:
Affected issues:
Suggested amendment:
Required revalidation:
```

然后显式：

1. reopen / supersede 对应 ADR/Contract Issue；
2. 形成新 revision；
3. 标记受影响 Issue；
4. 只重新执行真正受影响的 acceptance。

禁止 Agent 为完成本票而“顺手重构”已冻结语义。

---

## 2.5 两层验收

每个 Issue 都必须有：

### Unit Acceptance

在该 Issue 完成时即可运行，不等待未来功能。

例如 Graph API：

- API contract tests；
- bounded query tests；
- depth/limit negative tests；
- compatibility tests。

### Milestone Integration Gate

Milestone 最后一张 Gate 票验证多个 Issue 组合后的整体行为。

因此：

```text
Issue Done ≠ Milestone Done
```

但：

```text
Issue Done
```

必须是一个真实、独立、可验证的工程事实。

---

## 2.6 外部证据不能伪装成 AI 任务

例如：

- M17 连续四周 dogfood；
- ≥3 名新用户测试；
- M28 ≥3 个月 Endpoint 真实观察；
- M29 Windows/macOS/Linux 真机或 runner；
- 其他需要真实时间窗口的稳定性观察。

这些任务使用：

```text
Execution Class: H · External
```

模型可以负责准备脚本、收集数据、分析结果，但不能把缺失的真实 evidence“执行完成”。

因此 `完成 M17` 在外部证据尚未满足时应该正确返回 **BLOCKED_BY_EXTERNAL_EVIDENCE**，而不是虚假 Done。

---

## 2.7 UI / 视觉任务的双重验收

任何涉及 UI、视觉状态、布局、响应式、图形界面、交互反馈的 Issue，不能只以 DOM/单元/E2E 功能测试作为完成依据。必须同时提供**可重复的浏览器状态 + 视觉模型验收**。

最低要求：

1. 功能测试证明交互语义正确；
2. 在固定 viewport、固定 fixture、固定主题/字体加载条件下生成关键状态截图；
3. 由具备视觉理解能力的模型检查：
   - 布局、对齐、层级与间距；
   - 文本截断、溢出、遮挡、重叠；
   - loading / empty / error / disabled / selected / archived 等状态；
   - 响应式与缩放后的可读性；
   - Graph/Canvas 类界面的节点、边、标签、交互反馈是否与功能语义一致；
   - 关键交互完成后视觉状态是否与 Domain/Application 状态一致；
4. 对高风险 UI 改动保留 before/after 或 reference screenshot，视觉模型必须输出明确 `PASS / FAIL + defects`；
5. 若视觉模型发现布局/视觉缺陷，Issue 不得仅因自动化测试全绿而 Done。

推荐 Evidence：

```text
functional: unit/e2e/browser assertions
visual: screenshot set + visual-model verdict
reference: baseline/reference screenshots where applicable
viewport: desktop + task-relevant narrow viewport
```

对于 C-tier UI 任务，只有在设计、组件、状态语义均已冻结，且上述视觉验收可以机械执行时才允许 C；否则至少 B。

---

# 3. Linear 兼容格式

## 3.1 建议新增标签

建议后续写入 Linear 时新增：

```text
AI·A-SOTA
AI·B-Strong
AI·C-Fast
AI·H-External

Dispatch·Ready
Dispatch·Blocked
Dispatch·Tracking-Only

Contract·Freeze
Contract·Change-Required
```

现有标签如：

```text
难度·中
难度·高
难度·极高
安全
数据迁移
验收门禁
Feature
Improvement
候选·未承诺
```

继续保留。

**工程难度标签与 AI Tier 不合并。**

---

## 3.2 Linear Issue 描述模板

后续创建/修改 Issue 建议统一为：

```markdown
## Goal
一句话说明本票完成后形成的工程事实。

## Scope
- ...
- ...

## Out of Scope
- ...
- ...

## Required AI Tier
A | B | C | H

## Frozen Inputs
- ADR / schema / API / baseline
- 上游 Issue ID

## May Change
- ...

## Must Not Change
- ...

## Blocked By
- INH-xxx

## Unit Acceptance
- [ ] ...
- [ ] ...

## Failure / Escalation
出现以下情况停止施工：
- 需要修改 Frozen Input；
- acceptance 与 baseline 发生不可解释冲突；
- scope 必须扩展到未授权模块。

返回 `CONTRACT_CHANGE_REQUIRED` 或 `SCOPE_CHANGE_REQUIRED`。

## Evidence
- tests:
- fixtures:
- benchmark:
- visual_validation: required | n/a
- screenshots/reference:
- visual_model_verdict:
- commit/PR:
```

---

## 3.3 对旧 umbrella issue 的处理

如果现有 Issue 同时包含多个独立工作包，优先采用：

1. 恢复此前已经存在、目前标记 Duplicate 的细粒度 Issue；
2. 缩小当前 umbrella Issue 的 Scope；
3. 如果没有可复用旧票，再创建新 Issue；
4. 原 umbrella 若不再承担真实工程工作，应标记 `Tracking-Only` 或 superseded，不让 dispatcher 直接派发。

**Active work issue 必须是 dispatchable 的。**

---

# 4. Work Unit（WU）规则

WU 不是 Linear 的第二套 WBS，不产生新的产品语义。

WU 只引用**完整 Issues**：

```yaml
id: WU-M07-B2
milestone: M07
tier: B

issues:
  - INH-59
  - INH-60

requires:
  - INH-56
  - INH-58

entry_condition:
  blockers_done: true

exit_condition:
  all_issue_acceptance_green: true
```

硬规则：

1. 一个 Issue 不拆到多个 WU；
2. 一个 WU 只使用一个 AI Tier；
3. WU 启动时上游依赖必须已经完成；
4. WU 内 Issue 可以有顺序，但不能依赖未来 WU 才完成验收；
5. WU 是成本/上下文优化，不是必要概念；
6. 没有明显收益时直接派发 Issue。

---

# 5. 直接命令的工程语义

## 5.1 `完成 INH-xxx`

```text
resolve issue
→ validate blockers
→ validate frozen inputs
→ select minimum tier
→ create clean execution context/worktree
→ implement
→ run unit acceptance
→ submit evidence
```

## 5.2 `完成 WU-xxx`

```text
resolve WU
→ validate all external blockers
→ fixed model tier
→ sequential issue runs
→ each issue independently accepted
→ WU done
```

## 5.3 `完成 Mxx`

不是一个数周不间断 agent session，而是：

```text
resolve milestone
→ load active issue DAG
→ detect non-dispatchable issues
→ choose model ≥ milestone max tier
→ multiple clean execution runs
→ respect dependency order
→ run final gate
```

如果用户固定一个 SOTA 模型：

```text
完成 M07
```

可以让该模型完成 M07 全部 issues，但仍应拆成多个独立 runs/worktrees/checkpoints。

---

# 6. Milestone 级模型需求总览

| Milestone | Direct-dispatch 最低建议 | 外部阻断 | 备注 |
|---|---:|---|---|
| M06 | A | 否 | Run 状态机与 terminal race |
| M07 | A | 否 | Projection crash/rebuild 与删除语义 |
| M08 | A | 否 | Context contract / immutable history |
| M09 | A | 否 | Bundle/Purge/Security/Recovery |
| M10 | A | 24h observation | Cutover/rollback |
| M11 | A | 真实 dogfood | Architecture convergence |
| M12 | B | 否 | contract 已由 M06 冻结 |
| M13 | B | 否 | 产品化为主 |
| M14 | B | 否 | Graph 产品与性能 |
| M15 | B | 否 | Context 产品化 |
| M16 | A | 否 | 多模型 lifecycle/recovery |
| M17 | A + H | 4 周 + 新用户 | 不能纯 AI 自动完成 |
| M18 | B | 否 | UI/Graph UX |
| M19 | A | 否 | 新对象 taxonomy |
| M20 | A | 否 | Task semantics |
| M21 | A/B | 否 | Search contract 后大部分 B |
| M22 | A | 否 | embedding/privacy/version |
| M23 | A/B | 真实 telemetry 逐步积累 | 自动路由不在本项 |
| M24 | A | 真实 executor 环境 | side effects / fencing |
| M25 | A | 否 | Workflow contract/recovery |
| M26 | A | 否 | concurrency/permission/reconciliation |
| M27 | A | 真实 workflow outcome | Full Auto convergence |
| M28 | Candidate | ≥3 月真实数据 | 暂不拆 implementation |
| M29 | A | 三平台环境 | Desktop/packaging/security |
| M30 | Candidate | 真实使用证据 | 暂不拆 implementation |
| M31 | Candidate | first-party dogfood | 暂不公开 SDK |
| M32 | Candidate | 多项前置真实证据 | 暂不拆 implementation |

---

# 7. M06 · ExecutionRun 与 Chat 执行历史

**目标：** 每次 Chat/LLM 外部调用都有 durable、可解释终态。  
**Milestone Tier：A。**  
**当前 Issue 粒度：总体良好，主要需要补内部 DAG 与 AI Tier。**

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | Unit Acceptance | 处理 |
|---|---|---|---|---|---|---|
| 1 | INH-44 | ADR-006：Run 状态机/cancel/recovery/side-effect 边界 | A | M05 Gate | 状态迁移、late-result、Retry/Regenerate fixture 固定 | KEEP |
| 1 | INH-46 | ModelSpec / ProviderEndpoint identity backfill | B | M05 Gate | 幂等 backfill、同名 endpoint 隔离 | KEEP |
| 2 | INH-47 | immutable ContextEnvelope v0 | B | INH-44, INH-46 | Run 创建后输入不可改、hash 可复算；model/endpoint refs 与 identity contract 一致 | KEEP |
| 3 | INH-45 | execution_runs schema | B | INH-44, INH-46, INH-47 | migration/down、状态约束、ContextEnvelope/ref 字段与冻结 contract 一致、旧 Run 不覆盖 | KEEP |
| 4 | INH-48 | Tx A → external → guarded Tx C | A | INH-45 | terminal tracking 100%；late result 不覆盖终态 | KEEP |
| 5 | INH-50 | TraceSink / StreamSink backpressure | B | INH-45, INH-48 | 10k trace/run；Domain Event ≤10/run | KEEP |
| 5 | INH-49 | server cancel + Retry/Regenerate lineage | B | INH-48 | created/dispatching/running cancel race 全覆盖 | KEEP |
| 5 | INH-51 | telemetry_summary/error taxonomy | B | INH-46, INH-48 | endpoint 隔离；失败分类稳定；无 secret | KEEP |
| 6 | INH-53 | 消息侧 Run 状态/失败解释 | B | INH-49, INH-51 | 重启后 UI 收敛；失败/取消历史可见 | KEEP |
| 7 | INH-54 | M06 Gate | A | INH-45–53 | Gate 原有全部 blocking acceptance | KEEP |

推荐 WU：

```text
WU-M06-A1 = [INH-44]
WU-M06-B1 = [INH-46, INH-47, INH-45]  # strictly sequential within WU
WU-M06-A2 = [INH-48]
WU-M06-B2 = [INH-50, INH-49, INH-51]
WU-M06-B3 = [INH-53]
WU-M06-A3 = [INH-54]
```

---

# 8. M07 · Universal Work Graph Projection

**目标：** Graph 成为可重建、有界、与 Domain 真相分离的 Projection。  
**Milestone Tier：A。**  
**当前主要缺口：Linear 内部 blocker graph 不足。**

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | Unit Acceptance | 处理 |
|---|---|---|---|---|---|---|
| 1 | INH-55 | ADR-007 ObjectRef / relation taxonomy / Legacy 映射 | A | INH-54 | 固定映射 fixture + backward compatibility | KEEP |
| 2 | INH-56 | workspace_objects Registry / relation catalog | B | INH-55 | Conversation/Message/Run 注册并被投影消费 | KEEP |
| 3 | INH-57 | layout projection / 坐标迁出 Domain | B | INH-55, INH-56 | 回填幂等；layout_nodes 使用冻结 ObjectRef/registry；Domain write 不等 layout | KEEP |
| 3 | INH-58 | incremental projector/checkpoint/rebuild | A | INH-56 | checksum 一致；重复事件幂等；crash recovery | KEEP |
| 4 | INH-61 | archive/tombstone/retract/remove 全语义 | A | INH-55, INH-58 | 不物理删除 Domain；恢复/撤销可解释 | KEEP |
| 4 | INH-59 | neighborhood/path/tree/changes API | B | INH-56, INH-58 | nodes≤500；depth/limit hard cap | KEEP |
| 5 | INH-60 | GraphView 按需取数/渐进加载 | B | INH-57, INH-59 | 大图不首屏全量；原交互 characterization | KEEP |
| 6 | INH-62 | semantic diff/rebuild/bounded benchmark | B | INH-58, INH-59, INH-61 | semantic diff=0；10k bounded query evidence | KEEP |
| 7 | INH-63 | M07 Gate | A | INH-57, INH-60, INH-62 | 原 Gate 全绿 | KEEP |

推荐 WU：

```text
WU-M07-A1 = [INH-55]
WU-M07-B1 = [INH-56, INH-57]
WU-M07-A2 = [INH-58, INH-61]
WU-M07-B2 = [INH-59, INH-60]
WU-M07-B3 = [INH-62]
WU-M07-A3 = [INH-63]
```

---

# 9. M08 · Context Runtime v1

**Milestone Tier：A。**

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | Unit Acceptance | 处理 |
|---|---|---|---|---|---|---|
| 1 | INH-64 | ADR-008 cache/materialization/historical resolution | A | INH-63 | cache/version 生命周期可判定 | KEEP |
| 2 | INH-65 | Contributor/Index/Planner/Compiler contract | A | INH-64 | 四层 fixture 独立；Domain 无 provider 依赖 | KEEP |
| 3 | INH-66 | incremental candidate index | B | INH-65 | 常规 Planner full scan=0 | KEEP |
| 4 | INH-67 | cache key / invalidation vector | B | INH-66, INH-68 | stale cache 负例、ResourceVersion/index/Manifest/planner/compiler 变化均触发预期 invalidation | KEEP |
| 3 | INH-68 | ContextManifest v1 + DB immutable guard | B | INH-64, INH-65 | UPDATE/DELETE 被 DB 拒绝；版本引用真实 | KEEP |
| 5 | INH-69 | historical Manifest resolution | B | INH-68 | historical resolve=100%；无 silent fallback | KEEP |
| 6 | INH-70 | Context explain/history UI | B | INH-66, INH-68, INH-69 | why used/not used 可解释 | KEEP |
| 7 | INH-71 | Planner query/evidence audit | B | INH-66–70 | full-scan/immutability/cache characterization | KEEP |
| 8 | INH-72 | M08 Gate | A | INH-71 | 原 Gate 全绿 | KEEP |

推荐 WU：

```text
WU-M08-A1 = [INH-64, INH-65]
WU-M08-B1 = [INH-66, INH-68]
WU-M08-B2 = [INH-67, INH-69, INH-70]
WU-M08-B3 = [INH-71]
WU-M08-A2 = [INH-72]
```

---

# 10. M09 · Replay、Provenance 与 Portable Bundle v1

**Milestone Tier：A。**

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | Unit Acceptance | 处理 |
|---|---|---|---|---|---|---|
| 1 | INH-73 | ADR-009 Purge/Bundle/export safety | A | INH-72 | Purge、安全、format/version、staging 规则冻结 | KEEP |
| 2 | INH-74 | ProvenanceLink schema/API | B | INH-73 | output→input/manifest/run/model/endpoint 100% | KEEP |
| 2 | INH-75 | Replay 四分类 | B | INH-73, INH-69 | 四分类 100%；Missing silent fallback=0 | KEEP |
| 2 | INH-76 | explicit Purge v1 | A | INH-73 | 确认/审计/scope/派生物处置；失败安全 | KEEP |
| 2 | INH-77 | workspace.rhiza export/import | A | INH-73 | staging 原子激活；secret/path 泄露=0 | KEEP |
| 3 | INH-78 | malicious archive suite | A | INH-77 | Zip Slip/symlink/bomb/quota 拒绝=100% | KEEP |
| 3 | INH-80 | import checkpoints/crash/round-trip | A | INH-77 | checkpoint 恢复；checksum mismatch=0 | KEEP |
| 4 | INH-79 | Import/Export/Provenance/Replay Product | B | INH-74, INH-75, INH-77 | 用户纵切可演示 | KEEP |
| 5 | INH-81 | M09 Gate | A | INH-76, INH-78, INH-79, INH-80 | 原 Gate 全绿 | KEEP |

推荐 WU：

```text
WU-M09-A1 = [INH-73]
WU-M09-B1 = [INH-74, INH-75]
WU-M09-A2 = [INH-76, INH-77]
WU-M09-A3 = [INH-78, INH-80]
WU-M09-B2 = [INH-79]
WU-M09-A4 = [INH-81]
```

---

# 11. M10 · Legacy 写路径关闭

**Milestone Tier：A。**  
**External：INH-88 包含真实 24h observation。**

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | Unit Acceptance | 处理 |
|---|---|---|---|---|---|---|
| 1 | INH-82 | ADR-010 cutover/rollback/retention | A | INH-81 | cutover 与 rollback 条件冻结 | KEEP |
| 2 | INH-83 | legacy write observability | B | INH-82 | 每个旧写入口可定位；unknown=0 | KEEP |
| 3 | INH-84 | API/importer/projector/recovery 新边界 | B | INH-83 | direct legacy store call=0 | KEEP |
| 4 | INH-85 | reconciliation + rollback drill | A | INH-84 | checkpoint fault + rollback + checksum | KEEP |
| 4 | INH-86 | 删除 mutable/deletemissing 临时代码 | B | INH-84 | 旧物理历史写路径=0 | KEEP |
| 4 | INH-87 | flags 接线或移除 | B | INH-84 | 未接线 flag=0；fail-fast 与 docs 一致 | KEEP |
| 5 | INH-88 | 24h zero-write evidence | B + H | INH-85, INH-86, INH-87 | 连续 24h legacy write=0 | KEEP |
| 6 | INH-89 | M10 Gate | A | INH-88 | 原 Gate 全绿 | KEEP |

---

# 12. M11 · Chat-era Architecture Convergence v1

**Milestone Tier：A。**  
**External：真实复杂项目 dogfood。**

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | Unit Acceptance | 处理 |
|---|---|---|---|---|---|---|
| 1 | INH-95 | Trace Flood 10k | B | INH-89 | batch/backpressure 与性能 evidence | KEEP |
| 1 | INH-96 | current Host contract/degradation | B | INH-89 | current host suite green | KEEP |
| 1 | INH-97 | Bundle clean-store round trip | B | INH-89 | checksum + malicious archive regression | KEEP |
| 1 | INH-98 | Large Graph 10k/50k | B | INH-89 | bounded neighborhood p95/p99 | KEEP |
| 2 | INH-99 | Command/Graph/Context/Trace blocking budgets | B | INH-95, INH-98 | 冻结阈值全部有原始 evidence | KEEP |
| 2 | INH-100 | snapshot+tail replay / M01–M10 evidence audit | B | INH-89 | evidence 可复跑；staging migration 3 次一致 | KEEP |
| 2 | INH-90 | future additive seams（observational only） | B | INH-89 | fixture 只记录后续输入，不阻断 | KEEP |
| 3 | INH-101 | 一个真实复杂项目 dogfood | H + B | INH-99, INH-100 | 真实使用问题/evidence 归档 | KEEP |
| 4 | INH-102 | M11 Gate | A | INH-95–101（INH-90 不阻断） | Chat-era Kernel v1 Go/No-Go | KEEP |

注意：

- INH-90 明确不进入 blocking chain；
- dogfood 不能由合成 demo 替代；
- `完成 M11` 在真实 dogfood 未发生时应返回 External Block，而不是假完成。

---

# 13. M12 · Chat 核心体验完备

**Milestone Tier：B。**

此 Milestone 是一个重要验证点：在 M06 contract 已冻结后，复杂产品实现不必继续占用 SOTA 模型。

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | Unit Acceptance | 处理 |
|---|---|---|---|---|---|---|
| 1 | INH-103 | Stop 全链路 | B | INH-102 | UI/server cancel 一致 | KEEP |
| 1 | INH-104 | 临时支线流式 Run | B | INH-102 | stream/Stop/error；不落永久 Conversation | KEEP |
| 1 | INH-105 | Conversation model selection | B | INH-102 | 优先级/回退自动化 | KEEP |
| 2 | INH-106 | error class 恢复动作 | B | INH-103–105 | 所有 error class 有稳定恢复路径 | KEEP |
| 2 | INH-107 | offline/reconnect/Run refresh | B | INH-103 | 无重复消息；重启后最终收敛 | KEEP |
| 2 | INH-108 | Retry + parent_run_ref | B | INH-103 | Retry/Regenerate/Edit&Resend 可区分 | KEEP |
| 3 | INH-109 | keyboard/loading/empty/error UX | B | INH-106, INH-107 | 主路径空按钮=0；基础 A11y | KEEP |
| 4 | INH-110 | M12 Gate | B | INH-103–109 | 原 Gate 全绿 | KEEP |

---

# 14. M13 · Conversation 与 Multi-Workspace 管理产品化

**Milestone Tier：B。**

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | Unit Acceptance | 处理 |
|---|---|---|---|---|---|---|
| 1 | INH-111 | Conversation rename/state/archive/restore | B | INH-110 | characterization；默认隐藏归档 | KEEP |
| 1 | INH-112 | Segment UI | B | INH-110 | message revision 后引用可解释 | KEEP |
| 1 | INH-113 | Workspace 管理页 | B | INH-110 | scope/cache 泄露=0 | KEEP |
| 2 | INH-114 | lexical search v0 | B | INH-112 | fixture 内容可命中直达 | KEEP |
| 2 | INH-115 | Merge 参数接线 | B | INH-111, INH-112 | relation/event/manifest characterization | KEEP |
| 3 | INH-116 | M13 Gate | B | INH-111–115 | 空按钮/未接 API=0 | KEEP |

---

# 15. M14 · Graph 产品化

**Milestone Tier：B。**

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | Unit Acceptance | 处理 |
|---|---|---|---|---|---|---|
| 1 | INH-117 | Navigation/filter/legend | B | INH-116 | search/filter/focus automation | KEEP |
| 1 | INH-118 | viewport virtualization | B | INH-116, INH-59 | p95 budget；视口外 DOM=0 | KEEP |
| 1 | INH-119 | semantic zoom | B | INH-116 | 层级可判定；A11y fallback | KEEP |
| 1 | INH-120 | Graph→Context | B | INH-116, INH-72 | selection/Manifest characterization | KEEP |
| 1 | INH-121 | archive/tombstone visual semantics | B | INH-116, INH-61 | UI 与 Domain 状态一致 | KEEP |
| 2 | INH-122 | M14 Gate | B | INH-117–121 | 原 Gate 全绿 | KEEP |

---

# 16. M15 · Context 产品化

**Milestone Tier：B。**

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | Unit Acceptance | 处理 |
|---|---|---|---|---|---|---|
| 1 | INH-123 | Assisted confirm/reject→Manifest | B | INH-122 | 未确认项进入 Manifest=0 | KEEP |
| 1 | INH-124 | Auto/Assisted/Strict differentiation | B | INH-122 | 固定 fixture 行为可区分 | KEEP |
| 1 | INH-125 | Resource UX/broken refs | B | INH-122 | 可定位 missing 并修复/降级 | KEEP |
| 1 | INH-126 | Manifest UI | B | INH-122 | 历史 Manifest 不被当前推荐改写 | KEEP |
| 1 | INH-127 | Replay UI | B | INH-122 | 三分类路径；silent downgrade=0 | KEEP |
| 1 | INH-128 | Provenance UI | B | INH-122 | output→source chain 100% | KEEP |
| 2 | INH-129 | M15 Gate | B | INH-123–128 | 原 Gate 全绿 | KEEP |


### M12–M15 UI 统一附加验收

M12–M15 中所有包含 UI/UX 的 Issues（尤其 INH-103、106、109、111–115、117–121、123–128）均追加：

- 固定浏览器 fixture 截图；
- 视觉模型验证布局/层级/溢出/状态一致性；
- 至少覆盖主桌面 viewport；对 Sidebar、Graph、ContextPanel 等宽度敏感界面增加窄 viewport；
- 功能测试全绿但视觉模型判定存在明显遮挡、错位、不可读或状态表达错误时不得 Done。

Milestone Gate（INH-110/116/122/129）必须抽查对应关键视觉状态，而不是只读取子 Issue 的测试结果。


# 17. M16 · 多模型协作、设置与数据可靠性

**Milestone Tier：A。**

M16 是当前 Roadmap 中第一个明显出现“为了减少票数而合并多个独立工作包”的 Milestone。  
这里建议**恢复旧 duplicate 票的粒度**，以满足单 Issue 单模型等级、可独立验收的要求。

## 17.1 建议恢复/重切的 Collaboration issues

### INH-270：缩小为 Collaboration Core Contract & primitives

**保留 ID，缩小 Scope。**

建议只承担：

- collaboration identity / refs；
- `invoke(models, shared_context)`；
- `exchange(outputs, rounds)`；
- `synthesize(outputs)` 的底层 contract；
- 与 ExecutionRun / ContextManifest / Provenance 的引用关系；
- 第一轮共享 immutable context base 的隔离规则。

**Tier：A。**

**Blocked By：INH-129。**

Unit Acceptance：

- 第一轮各模型输入 hash 一致；
- first-round cross-visibility=0；
- participant/run/manifest/model/endpoint refs 100% 可追；
- primitives 可由 deterministic fake runtime 独立 fixture。

### INH-277：恢复为 Collaboration lifecycle / budget / recovery

当前为 Duplicate，建议恢复 Active。

Scope：

- collaboration lifecycle；
- partial failure；
- per-participant retry；
- cancel/Stop；
- timeout；
- token/time/round budget；
- restart recovery；
- 不静默丢失失败参与者。

**Tier：A。**

**Blocked By：INH-270。**

Unit Acceptance：

- hard max rounds 100%；
- hard budget 超限终止；
- Stop 对活动 Run 生效；
- restart 后状态收敛；
- partial failure 进入 synthesis 时显式标记。

### INH-271：缩小为 Independent Review / Peer Review / Second Opinion

**Tier：B。**

Scope：

- Independent Review；
- Peer Review；
- Second Opinion；
- 第一轮默认隔离；
- 输出共同结论、独立发现、遗漏/风险、分歧。

Blocked By：

- INH-270；
- INH-277。

Unit Acceptance：

- 固定问题 fixture；
- reviewer 第一轮互不可见；
- provenance 完整；
- participant failure 有明确状态。

### INH-272：恢复为 bounded Debate

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Scope：

- independent position；
- explicit exchange；
- bounded rounds；
- Stop；
- convergence/remaining disagreement 输出；
- 不建立 Debate Engine / Argument Graph。

Blocked By：

- INH-270；
- INH-277。

Unit Acceptance：

- round hard limit；
- exchange visibility 与策略一致；
- Stop 100%；
- 无无限循环。

### INH-273：恢复为 Synthesis

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Scope：

- recommendation；
- alternatives；
- tradeoffs；
- unresolved disagreement/risk；
- why recommended；
- source participant provenance。

Blocked By：

- INH-270；
- INH-277；
- INH-271；
- INH-272。

Unit Acceptance：

- 不丢失败 participant；
- recommendation 必须带理由；
- alternatives 不被压平；
- 来源 Run 可追。

### INH-278：Product UI

保持 Active。

**Tier：B。**

Blocked By：

- INH-271；
- INH-272；
- INH-273。

Unit Acceptance 保持当前 Linear 定义：

- 从 Conversation/Branch 发起；
- 选择模型/endpoint/budget；
- 查看 participant 状态；
- Stop；
- synthesis/alternatives/provenance；
- 不污染未选择 context。

---

## 17.2 Settings / Data issues

| Linear | 任务 | Tier | 建议 blocked_by | 处理 |
|---|---|---|---|---|
| INH-130 | Bundle UX / Backup / Restore | B | INH-129 | KEEP |
| INH-132 | Provider catalog scope/persistence decision + endpoint settings contract | A | INH-129 | **SHRINK：只冻结 global/per-workspace ownership、secret/export 边界、health/catalog contract** |
| NEW-M16-PROVIDER-UI | Endpoint health、失效 key、模型目录/排序与设置 UI | B | INH-132 | **NEW：纯实现/产品化，不再自行决定 persistence scope** |
| INH-133 | secret/path scan + export safety + runbook | B | INH-130 | KEEP |
| INH-135 | M16 Final Gate | A | 130,132,133,270,277,271,272,273,278 | KEEP |

INH-131/134 保持 Duplicate，不必恢复；它们当前拆出的内容仍可在 INH-130/133 内形成 coherent PR。

推荐 WU：

```text
WU-M16-A1 = [INH-270, INH-277, INH-132]
WU-M16-B1 = [INH-130, INH-133, NEW-M16-PROVIDER-UI]
WU-M16-B2 = [INH-271, INH-272, INH-273]
WU-M16-B3 = [INH-278]
WU-M16-A2 = [INH-135]
```

---

# 18. M17 · 稳定性验收与 Daily Replacement Matrix

**Milestone Tier：A + H。**

M17 不能设计成“模型把所有票做完就宣布产品完成”。  
真实观察窗口和新用户 evidence 是硬外部依赖。

## 18.1 建议恢复被合并的 evidence issues

### INH-136 · Freeze Acceptance Matrix

**Tier：A。**

Blocked By：INH-135。

要求在测试开始前冻结：

- functional；
- recovery/data；
- context；
- performance；
- browser stability；
- A11y/UX；
- dogfood；
- new-user tasks。

修改 Matrix 必须触发相应重新验收。

### INH-137 · Functional coverage

建议缩小为：

- Provider/Model；
- stream/Stop/Retry/Regenerate/Edit&Resend；
- attachment/rendering；
- Workspace/Conversation；
- Graph/Context；
- Model Collaboration；
- 普通 single-model Chat 不依赖 collaboration。

**Tier：B。**

### INH-141 · 恢复为 Context integrity / Replay / Provenance

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Unit Acceptance：

- Auto/Assisted/Strict；
- historical Manifest；
- provenance；
- Replay；
- Missing-resource；
- current recommendation 不改写 history。

### INH-143 · 恢复为 UX/A11y states

当前 Duplicate，建议恢复 Active。

**Tier：B。**

覆盖：

- loading；
- empty；
- error；
- offline；
- reconnect；
- retry；
- cancel；
- keyboard/focus；
- screen-reader baseline。

### INH-139 · Runtime/Storage fault recovery

建议缩小为：

- network/SSE/provider/restart；
- storage full/write failure；
- no half-commit；
- error class + recovery action。

**Tier：B。**

### INH-140 · 恢复为 Portable round-trip / backup restore

当前 Duplicate，建议恢复 Active。

**Tier：B。**

### INH-142 · Performance + 1h Browser stability

保持 Active。

**Tier：B + H(environment/time)。**

### INH-144 · Owner dogfood 4 weeks

建议缩小为 Owner dogfood。

**Tier：H。**

模型可负责：

- instrumentation；
- weekly report；
- severity clustering；
- regression analysis。

但四周真实观察不能自动生成。

### INH-145 · 恢复为 ≥3 New-user study

当前 Duplicate，建议恢复 Active。

**Tier：H。**

不得被 Owner dogfood 替代。

### INH-147 · Final Go/No-Go

**Tier：A。**

Blocked By：

- INH-136；
- INH-137；
- INH-141；
- INH-143；
- INH-139；
- INH-140；
- INH-142；
- INH-144；
- INH-145。

INH-146 保持 Duplicate。

推荐执行分组：

```text
WU-M17-A1 = [INH-136]
WU-M17-B1 = [INH-137, INH-141, INH-143]
WU-M17-B2 = [INH-139, INH-140, INH-142]
External = [INH-144, INH-145]
WU-M17-A2 = [INH-147]
```

---

# 19. M18 · UI / 信息架构升级与 Graph UX v2

**Milestone Tier：B。**

当前 Issues 基本已经满足 dispatchable 粒度，不建议再拆。**所有 M18 Issue 均要求浏览器截图 + 视觉模型验收；INH-153 Gate 必须检查关键 viewport 的视觉回归。**

| Linear | 任务 | Tier | 建议 blocked_by | 处理 |
|---|---|---|---|---|
| INH-148 | Workspace-centered IA | B | INH-147 | KEEP |
| INH-149 | Graph multi-select/batch commands | B | INH-148 | KEEP |
| INH-150 | layer filtering | B | INH-148 | KEEP |
| INH-151 | Context Tray | B | INH-148, INH-150 | KEEP |
| INH-152 | view state persistence | B | INH-148 | KEEP |
| INH-153 | M18 Gate | B | 149–152 | KEEP |

推荐 WU：

```text
WU-M18-B1 = [INH-148, INH-150, INH-152]
WU-M18-B2 = [INH-149, INH-151]
WU-M18-B3 = [INH-153]
```

---

# 20. M19 · Workspace State / Artifact / Knowledge / Decision

**Milestone Tier：A。**

| 顺序 | Linear | 任务 | Tier | 建议 blocked_by | 处理 |
|---|---|---|---|---|---|
| 1 | INH-154 | object/event taxonomy ADR | A | INH-153 | KEEP |
| 2 | INH-155 | schema + Registry | B | INH-154 | KEEP |
| 3 | INH-156 | message→State product | B | INH-155 | KEEP |
| 3 | INH-157 | State Projection | B | INH-155 | KEEP |
| 3 | INH-158 | Graph/Context/supersedes | B | INH-155 | KEEP |
| 4 | INH-159 | M19 Gate | A | INH-156–158 | KEEP |

Unit Acceptance 继续使用当前 Linear 描述；重点是 INH-154 完成后，后续不得自行发明新的 object/event semantics。

---

# 21. M20 · Task 对象与 Complex Task Workspace 基础

**Milestone Tier：A。**

当前 M20 是另一个明显 umbrella 化 Milestone。  
建议优先恢复现有 Duplicate 票。

## 21.1 Task facts

### INH-160：缩小为 Task Semantics / ADR

只保留：

- Goal/Task semantics；
- Task 独立于 Conversation；
- TaskPlan revision/version；
- blocked_by / depends_on 语义；
- historical resolution；
- state event taxonomy。

**Tier：A。**

Blocked By：INH-159。

### INH-161：恢复为 Schema / Registry / version storage

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-160。

Unit Acceptance：

- additive migration；
- logical identity；
- old TaskPlan versions preserved；
- provenance；
- rollback/re-run。

---

## 21.2 Dependency / Projection

### INH-162：缩小为 dependency semantics implementation + cycle detection

**Tier：B。**

Blocked By：INH-160, INH-161。

Unit Acceptance：

- blocked_by/depends_on；
- cycle detection；
- concurrent relation conflict；
- block explanation API。

### INH-163：恢复为 Task Graph View

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-162。

Unit Acceptance：

- generic Graph Projection；
- clean rebuild；
- bounded query；
- relation changes eventually reflected。

---

## 21.3 Complex Task Workspace

### INH-164：缩小为 Task↔Conversation/Artifact + stale/product surface

**Tier：B。**

Blocked By：INH-161。

### INH-197：恢复为 Workstream + static Plan mapping

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-161, INH-162。

### INH-276：恢复为 per-task Context ref + execution intent

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-161, INH-197, M15 Context baseline。

注意这里只记录：

- human/model/agent static intent；
- versioned Context Packet/selection ref；

**不执行 Workflow dispatch。**

### INH-165：M20 Gate

**Tier：A。**

Blocked By：

- INH-163；
- INH-164；
- INH-197；
- INH-276。

推荐 WU：

```text
WU-M20-A1 = [INH-160]
WU-M20-B1 = [INH-161, INH-162, INH-163]
WU-M20-B2 = [INH-164, INH-197, INH-276]
WU-M20-A2 = [INH-165]
```

---

# 22. M21 · Search 与 Resource 管理

**Milestone Tier：A/B。**

二次审计发现一个真实依赖矛盾：Roadmap 允许 M20 与 M21 在 M19 后并行，但当前 M21 Search scope/Gate 又要求 `Task` 可搜索。B-tier 实现不能在 M20 Task contract 尚未冻结时自行猜 Task schema。

正确拆法是让 Search Core 与 M20 并行，Task integration 在 M20 contract 完成后汇合；M21 Gate 因此等待该 integration，但不会阻止 M21 前半段与 M20 并行开发。

### INH-166：缩小为 Search contract + index lifecycle（既有对象）

**Tier：A。**

Blocked By：INH-159。

冻结：

- 通用 SearchQuery / scope / filter / sort / pagination；
- index version / rebuild / rollback；
- index 不是事实源；
- object-type adapter seam；
- 首批冻结对象：Conversation / Message / Resource / Artifact / Knowledge / Decision 等 **M19 时已经存在的对象族**；
- 明确 Task 通过后续 adapter 加入，不在本票预定义 Task 字段。

### INH-167：恢复为 Unified Search Core implementation

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-166。

覆盖 M19 baseline 已存在对象族，包含 deterministic ordering、quality/performance fixture、index rebuild equivalence。

### NEW-M21-TASK-SEARCH：Task Search adapter / integration

**Tier：B。**

Blocked By：INH-160, INH-161, INH-167。

Scope：

- 按已经冻结的 Goal/Task/TaskPlan contract 接入 Search object adapter；
- 不改变 SearchQuery 与 Task semantics；
- Task/TaskPlan fixture 可命中、过滤、scope 正确；
- M20 revision 后旧版本/当前版本搜索行为有明确规则。

这样 M20 与 M21 Core 仍可并行，但 M21 最终 Gate 不会在 Task 尚不存在时伪造验收。

### INH-168：Resource lineage / broken refs

保持 Active。

**Tier：B。**

Blocked By：INH-166, INH-167。

### INH-169：恢复为 Search result navigation

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-167, INH-168。

若包含可见 UI，必须执行浏览器截图 + 视觉模型验证定位后的高亮、空/失效状态、布局和溢出。

### INH-170：M21 Gate

**Tier：B。**

Blocked By：INH-167, NEW-M21-TASK-SEARCH, INH-168, INH-169。

Gate 可按“一整个统一搜索功能”验收，不要求每张实现票重复所有对象测试；但必须证明所有当前工作对象族（含真实 Task）可搜索、scope 正确、结果可定位、索引 rebuild 等价。

推荐 WU：

```text
WU-M21-A1 = [INH-166]
WU-M21-B1 = [INH-167, INH-168, INH-169]
WU-M21-B2 = [NEW-M21-TASK-SEARCH, INH-170]
```

---

# 23. M22 · Context Planner v2 / Context Intelligence v0

**Milestone Tier：A。**

M22 当前存在明显 mixed-tier umbrella，应恢复此前的细粒度票。

## 23.1 Embedding

### INH-171：缩小为 embedding/privacy/version ADR

只保留：

- local/configurable provider；
- data egress/privacy；
- model/dimension；
- index version；
- clear/rebuild/rollback；
- fallback semantics；
- Domain 不绑定 embedding implementation。

**Tier：A。**

Blocked By：

- INH-165；
- INH-170。

### INH-173：恢复为 materialization + lifecycle + lexical fallback

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-171。

Unit Acceptance：

- incremental/full rebuild；
- checkpoint/restart；
- model/dimension/version 不混读；
- unavailable/rebuild 时 lexical fallback；
- full Workspace scan=0。

---

## 23.2 Multi-source intelligence

### INH-172：缩小为 Contributors + explainable scoring

**Tier：B。**

Blocked By：

- INH-165；
- INH-170；
- INH-173（若 embedding contributor 启用）。

Scope：

- Artifact/Task/Decision contributor；
- Graph neighborhood；
- recency；
- independent enable/disable/version；
- contributor source/reason recorded in Manifest。

### INH-175：恢复为 conflict hint v0

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-172。

不得自动 semantic merge。

### INH-174：Context Packet preflight

**Tier：B。**

若包含发送前审阅 UI，除 payload/删减功能测试外，必须用视觉模型验证候选列表、预算提示、删减状态、溢出和窄 viewport。

Blocked By：INH-172, INH-175。

### INH-176：M22 Gate

**Tier：A。**

Blocked By：INH-173, INH-174, INH-175。

推荐 WU：

```text
WU-M22-A1 = [INH-171]
WU-M22-B1 = [INH-173]
WU-M22-B2 = [INH-172, INH-175, INH-174]
WU-M22-A2 = [INH-176]
```

---

# 24. M23 · Execution Observability 与 Routing Assistance

**Milestone Tier：A/B。**

当前 `INH-177` 将 metric contract、analytics、profile 合并。  
建议恢复旧票，使数据口径先冻结，再实施聚合。

### INH-177：缩小为 Metric contract

**Tier：A。**

Blocked By：INH-147。

冻结：

- TTFT；
- latency；
- error；
- token/cost；
- time window；
- sample count；
- confidence；
- unknown/untrusted；
- same model / different endpoint never merge。

### INH-179：恢复为 Analytics query

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-177。

### INH-180：恢复为 Endpoint profile v0

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-179。

### INH-178：Run UI

**Tier：B。**

必须同时执行功能 E2E 与视觉模型验收，覆盖 timeline、stale attempt、错误/取消/重试状态、长错误文本与窄 viewport。

Blocked By：INH-177。

### INH-181：Manual recommendation / fallback / RoutingDecision

**Tier：B。**

Blocked By：INH-177, INH-180。

注意：

- 不做 Adaptive Routing；
- recommendation 可被用户否决；
- RoutingDecision immutable；
- 当前 profile 变化不改写历史 decision。

### INH-182：M23 Gate

**Tier：B。**

Blocked By：178–181。

推荐 WU：

```text
WU-M23-A1 = [INH-177]
WU-M23-B1 = [INH-179, INH-180]
WU-M23-B2 = [INH-178, INH-181, INH-182]
```

---

# 25. M24 · External Executor / Agent Harness v1

**Milestone Tier：A。**

M24 涉及真实 side effects，不能为了降低成本把安全/并发语义下放给低等级模型。

## 25.1 Security

### INH-183：缩小为 Executor capability / scoped input / approval contract

**Tier：A。**

Blocked By：INH-182。

Scope：

- ExecutorProfile/capability；
- `side_effects`；
- action category；
- cancel/pause capability declaration；
- unknown capability default deny；
- Resource/Context/cwd/env/file scope；
- stable approval request contract。

### INH-186：恢复为 Approval UX

当前 Duplicate，建议恢复 Active。

**Tier：B。**

视觉验收为阻断项：视觉模型必须确认 action/scope/resource/effect/risk 的层级清晰，无截断/遮挡，危险操作与普通操作的状态表达不混淆；同时由 E2E 验证实际 approval contract 不可绕过。

Blocked By：INH-183。

---

## 25.2 Adapters

### INH-184：缩小为 controlled CLI RuntimeAdapter

**Tier：B。**

Blocked By：INH-183。

### INH-185：恢复为 Agent/Harness adapter

当前 Duplicate，建议恢复 Active。

**Tier：B。**

Blocked By：INH-183。

必须证明：

- 同一个 Executor contract；
- capability mismatch 可解释；
- 不绕过 scope/approval；
- adapter 特性不泄漏到 Core。

---

## 25.3 Effects / fencing / recovery

### INH-187：缩小为 Effect provenance + lease/fencing

**Tier：A。**

Blocked By：INH-183, INH-184。

Unit Acceptance：

- Effect 100% 追 approval/Run/input；
- stale epoch effect 不接受；
- duplicate effect=0；
- side_effects=false 不被强制套用 side-effect lease。

### INH-52：恢复为 adapter crash + reconciliation

当前 Duplicate，建议恢复 Active，并明确归属 M24。

**Tier：A。**

Blocked By：INH-187, INH-185。

覆盖：

- dispatch 前后 crash；
- effect 前后 crash；
- terminal 前后 crash；
- restart reconciliation；
- stale terminal；
- disable fallback。

### INH-189：M24 Gate

**Tier：A。**

Blocked By：

- INH-186；
- INH-184；
- INH-185；
- INH-187；
- INH-52。

推荐 WU：

```text
WU-M24-A1 = [INH-183]
WU-M24-B1 = [INH-186, INH-184, INH-185]
WU-M24-A2 = [INH-187, INH-52]
WU-M24-A3 = [INH-189]
```

---

# 26. M25 · Automation Workflow v1

**Milestone Tier：A。**

M25 应保持最小可靠闭环，不扩展为通用 workflow platform。

## 26.1 Contract

### INH-279 · WorkflowDefinition / WorkflowRun v1

保持 Active。

**Tier：A。**

Blocked By：

- INH-165；
- INH-176；
- INH-189。

Unit Acceptance：

- versioned Definition/Run；
- Goal/Plan/Task/WorkOrder/Run refs；
- control node vs work node；
- Sequence/bounded Parallel/Evaluate/Gate/rework semantics；
- transition idempotency contract；
- historical run resolution；
- Manual/Assisted boundary。

---

## 26.2 Runtime / Recovery

### INH-280：缩小为 control-flow runtime + persistent transition

**Tier：A。**

Blocked By：INH-279。

Scope：

- Sequence；
- bounded Parallel；
- Evaluate/Gate branch；
- rework loop；
- persistent idempotent transition；
- control node 不伪造 ExecutionRun。

### INH-188：恢复为 crash/restart / duplicate dispatch protection

当前 Duplicate，建议恢复 Active。

**Tier：A。**

Blocked By：INH-280, INH-281。

覆盖：

- dispatch receipt；
- crash/restart；
- partial parallel recovery；
- duplicate dispatch=0；
- Stop/abort；
- stale transition reject。

---

## 26.3 Dispatch

### INH-281 · Plan→Task→WorkOrder→Executor

保持 Active。

**Tier：A。**

原因：这是首次把 Task、Context、Executor、ExecutionRun 真正连接成 side-effecting workflow path，blast radius 高于普通 adapter 实现。

Blocked By：

- INH-279；
- INH-189。

Unit Acceptance：

- LLM worker；
- side-effecting executor；
- static role→model/executor mapping；
- provenance；
- capability/approval failure taxonomy。

---

## 26.4 Evaluate

### INH-282 · Acceptance / Review / revise-replan

保持 Active。

**Tier：A。**

Blocked By：

- INH-280；
- INH-281。

Unit Acceptance：

- objective test pass；
- review fail→revise→pass；
- replan path；
- 无法客观验证时 recommendation + remaining risk；
- steps finished 不等于 workflow completed。

---

## 26.5 Consult / Product

### INH-92：建议拆成两个 dispatchable Issue

当前 INH-92 同时包含：

- BLOCKED escalation policy；
- Consult；
- Workflow 操作 UI。

建议：

#### INH-92 · Consult / BLOCKED handling

保留 ID。

**Tier：A。**

Scope：

```text
retry
→ re-contextualize
→ consult
→ replan
→ reassign
→ user escalation only when required
```

以及：

- consult result provenance；
- 返回原 node；
- escalation boundary。

Blocked By：INH-280, INH-282。

#### NEW-M25-PRODUCT · Workflow UI

创建新 Issue。

**Tier：B。**

视觉验收为阻断项：固定 workflow fixtures 生成 running/blocked/approval/consult/failed/completed 等截图，由视觉模型验证 timeline 层级、状态区分、溢出与主要操作可发现性。

Scope：

- Plan/Task/WorkOrder/Run/Evaluate timeline；
- current block reason；
- approval/consult request；
- Stop；
- Manual/Assisted；
- reconstruction after restart。

Blocked By：

- INH-92；
- INH-188；
- INH-282。

### INH-198 · M25 Gate

**Tier：A。**

Blocked By：

- INH-188；
- INH-281；
- INH-282；
- INH-92；
- NEW-M25-PRODUCT。

推荐 WU：

```text
WU-M25-A1 = [INH-279]
WU-M25-A2 = [INH-280, INH-281]
WU-M25-A3 = [INH-188, INH-282, INH-92]
WU-M25-B1 = [NEW-M25-PRODUCT]
WU-M25-A4 = [INH-198]
```

---

# 27. M26 · Multi-Agent Orchestration v1

**Milestone Tier：A。**

当前 M26 只有两个很大的 Core/Lifecycle issues + Gate。  
为了真正支持单 Issue 直接派发，建议在进入 M26 前进行一次拆分；现在先定义目标切面，不提前设计更深内部 runtime。

## 27.1 Assignment contract

### INH-94：缩小为 Assignment / RunGroup contract

**Tier：A。**

Blocked By：INH-198。

只冻结：

- Assignment identity/status；
- Task/WorkOrder refs；
- Executor ref；
- Context refs；
- scope；
- Run lineage；
- RunGroup semantics；
- 不改变 WorkflowDefinition 控制流。

---

## 27.2 新增：bounded parallel scheduler

### NEW-M26-SCHEDULER

**Tier：A。**

Blocked By：INH-94。

Scope：

- ≥3 Workstreams；
- ≥2 Executors；
- bounded parallel dispatch；
- independent completion；
- capacity/capability mismatch；
- 不做通用 distributed scheduler。

Unit Acceptance：

- deterministic fixtures；
- parallel completion order 不改变 Workflow semantics；
- no duplicate Assignment execution。

---

## 27.3 新增：retry / reassign

### NEW-M26-REASSIGN

**Tier：B。**

Blocked By：NEW-M26-SCHEDULER。

Scope：

- retry；
- executor unavailable；
- reassign；
- lineage preserved；
- failure classification。

---

## 27.4 Lifecycle

### INH-93：缩小为 cancel / pause-resume capability / handoff / takeover

**Tier：A。**

Blocked By：NEW-M26-SCHEDULER。

注意：

- pause/resume 只在 Harness 声明支持时启用；
- 单 Assignment cancel 不停止整个 Workflow；
- handoff 显式传递状态/Context/artifact；
- human takeover 可独立接管。

---

## 27.5 新增：per-Assignment permission/capability

### NEW-M26-PERMISSION

**Tier：A。**

Blocked By：INH-94, INH-183。

Unit Acceptance：

- 每个 Assignment 独立 capability；
- cross-Assignment access negative tests；
- privilege escalation 拒绝；
- provenance 可追授权链。

---

## 27.6 新增：conflict reconciliation

### NEW-M26-RECONCILIATION

**Tier：A。**

Blocked By：

- NEW-M26-SCHEDULER；
- INH-93；
- NEW-M26-PERMISSION。

Scope：

- conflicting artifacts/effects；
- explicit reconciliation；
- no last-write-wins；
- user takeover/consult seam；
- trajectory/evidence。

### INH-199 · M26 Gate

**Tier：A。**

Blocked By：

- NEW-M26-REASSIGN；
- INH-93；
- NEW-M26-PERMISSION；
- NEW-M26-RECONCILIATION。

---

# 28. M27 · Full Auto & Workflow Quality v1

**Milestone Tier：A。**

当前 INH-203 包含过多独立工作包，不适合直接作为一个长期 execution unit。  
建议在进入 M27 时拆成以下 Issues；现在只冻结高层任务边界，不提前定义更复杂 authority subsystem。

## 28.1 INH-203 · Autonomy mode & escalation contract

缩小当前 ID。

**Tier：A。**

Scope：

- Goal；
- constraints；
- resource/quality strategy；
- minimal clarification；
- escalation only for：
  - goal change；
  - value trade-off；
  - major irreversible risk；
  - unresolved critical conflict；
  - explicit approval。

Unit Acceptance：

- 固定 scenario 判断 ask / not-ask；
- BLOCKED 不自动 ask user；
- contract 不引入 authority state machine。

---

## 28.2 NEW-M27-AUTOLOOP · autonomous workflow loop

**Tier：A。**

Blocked By：INH-203, INH-199。

Scope：

```text
Plan
→ Dispatch
→ Execute
→ Evaluate
→ Revise/Replan
→ Deliver
```

允许跨多轮自主推进，但沿用 M25/M26 runtime，不建立第二套 engine。

---

## 28.3 NEW-M27-QUALITY · evaluator composition

**Tier：A。**

Blocked By：INH-282, NEW-M27-AUTOLOOP。

Scope：

- acceptance criteria；
- objective tests/evaluators；
- independent review where useful；
- recommendation + alternatives + risks；
- evidence refs。

---

## 28.4 NEW-M27-CONVERGENCE · convergence / budget / stop

**Tier：A。**

Blocked By：NEW-M27-AUTOLOOP, NEW-M27-QUALITY。

Scope：

- max iterations；
- progress/no-progress signal；
- resource budget；
- convergence；
- Stop；
- fallback Assisted；
- no infinite revise loop。

---

## 28.5 NEW-M27-PRODUCT · user control / status / delivery

**Tier：B。**

视觉验收为阻断项：至少覆盖 autonomous running、waiting approval、blocked、takeover、completed/delivery 五类状态，并由视觉模型判断层级、风险提示、Stop/takeover 可发现性和窄 viewport。

Blocked By：NEW-M27-AUTOLOOP, NEW-M27-CONVERGENCE。

Scope：

- autonomy mode；
- current plan；
- iteration/evaluation history；
- stop/takeover；
- delivery summary；
- remaining risk。

---

## 28.6 NEW-M27-EVIDENCE · scenario suite

**Tier：B + H（真实 workflow outcome 部分）。**

Blocked By：NEW-M27-QUALITY, NEW-M27-PRODUCT。

固定至少覆盖：

- objective coding/task；
- partially subjective knowledge/task；
- recoverable failure；
- executor failure；
- conflict；
- impossible/blocked task；
- budget exhaustion；
- user escalation boundary。

### INH-269 · M27 Gate

**Tier：A。**

Blocked By：

- NEW-M27-EVIDENCE；
- 真实 Workflow outcome evidence。

---

# 29. M28 · Adaptive Routing v2 / Personal Capability Model

**状态：长期优化。**

当前只保留：

### INH-200 · Activation Gate

**Execution Class：H + A。**

启动前置：

- M23 Endpoint profile ≥3 个月真实使用；
- 足量 sample/window/confidence；
- M25/M26 真实任务 outcome；
- 用户主观体验与画像基本一致；
- Manual/Pinned/static mapping 可用。

**不建议现在创建 implementation issues。**

理由：

- 数据分布尚不存在；
- 评分模型应由真实 endpoint/time/task evidence 驱动；
- 现在拆 issue 会把假设写成架构事实。

当 INH-200 通过后，再执行一次独立 Roadmap decomposition，届时才创建：

- scoring contract；
- capability profile；
- conditional features；
- routing decision policy；
- route fingerprint；
- Pareto evaluation；
- manual override/clear history；
- drift/time-window detection。

---

# 30. M29 · Desktop / 跨平台 Host

**Milestone Tier：A。**

当前 Issue 粒度基本合理。

| Linear | 任务 | Tier | External | 建议 blocked_by | 处理 |
|---|---|---|---|---|---|
| INH-190 | Tauri/Electron/embedded/security ADR | A | 否 | M27 或产品显式重排 | KEEP |
| INH-191 | DesktopHostAdapter | B | 目标 OS | INH-190 | KEEP |
| INH-192 | Win/macOS/Linux packaging/signing | B | 是 | INH-190,191 | KEEP |
| INH-193 | embedded/backup/multi-workspace export | B | 否 | INH-191 | KEEP |
| INH-195 | 10k Desktop/Server benchmark | B | 是 | INH-191–193 | KEEP |
| INH-196 | M29 Gate | A | 是 | INH-192,193,195 | KEEP |

注意：

- 三平台 smoke 必须使用真实 runner/VM/机器；
- 模型可以操作 CI，但不能声称未运行平台已经通过。

---

# 31. M30 · Context / Memory Intelligence（候选）

当前只保留：

### INH-201 · Candidate Gate

**Execution Class：H + A。**

启动条件继续沿用：

- M19 Knowledge 稳定；
- M22 Context metrics 稳定；
- M20/M25 真实复杂任务证明长期记忆价值；
- privacy/Purge ADR 完成。

**不提前拆 Memory implementation。**

如果真实需求最终只需要 better Context/Knowledge retrieval，应允许 M30 不启动。

---

# 32. M31 · Plugin Ecosystem / Extension Registry（候选）

当前：

- INH-194 Internal extension validation；
- INH-202 Candidate Gate。

保持当前粒度，不提前公开 SDK。

### INH-194

**Tier：A。**

但只有在启动条件满足后才进入 Active。

如果未来真正启动，INH-194 很可能需要进一步拆为：

- internal manifest/permission contract；
- lifecycle/storage；
- first-party extension 1；
- first-party extension 2；
- security/upgrade/uninstall evidence。

现在不创建这些票。

### INH-202

**Execution Class：H + A。**

只有 ≥2 个 first-party extension 完整 dogfood 后才决定是否公开 Registry/SDK。

---

# 33. M32 · Mission / Control & Observability Plane（候选）

当前只保留：

### INH-268 · Candidate Gate

**Execution Class：H + A。**

启动依赖：

- M25；
- M26；
- M28；
- M31；
- 高频 Multi-Workspace 使用；
- Mission scope ADR。

不创建实现 Issues，直到真实使用证明需要跨 Workspace 统一控制面。

---

# 34. 推荐的 Linear 写回策略

本文后续如果交给 Agent 写入 Linear，建议分批操作，而不是一次性修改全项目。

## Batch 1 · 只处理 M06–M08

目标：

- 创建 AI Tier labels；
- 给 M06–M08 Active issues 加 Tier；
- 修正内部 blockers；
- 不改任务内容；
- 校验无循环依赖。

这是最安全的试点。

验收：

```text
complete INH-xx
```

对于 M06–M08 每张票都能回答：

- 是否 Ready；
- 最低模型 Tier；
- blockers；
- unit acceptance；
- frozen inputs。

---

## Batch 2 · M09–M15

主要工作：

- 补 blocker DAG；
- 加 Tier；
- 无需大规模拆票。

这一段现有颗粒度整体已经较好。

---

## Batch 3 · M16–M24

执行：

- 恢复本文件指定 Duplicate issues；
- 缩小 umbrella issue；
- 新建极少数确有必要的新票；
- 给恢复后的票重建 blocker graph；
- 旧历史保留。

这是本次 Roadmap 整理的主要结构变更区。

---

## Batch 4 · M25–M27

不要现在直接写入全部新票。

建议在：

- M17 已通过；
- M20/M22/M24 真实实现；
- 即将开始 Workflow；

时再次根据 repository reality 校验本文件提出的 split。

原则和边界可以现在保留，但具体 files/API/schema 由届时 baseline 决定。

---

## Batch 5 · M28–M32

不做 implementation decomposition。

只维护 Candidate Gate 与启动 evidence。

---

# 35. Agent 写入 Linear 时的执行规则

后续如果让 Agent 根据本文修改 Linear，必须：

1. 先读当前 Linear，再 diff 本文；不得假设 Issue 状态没有变化；
2. M01–M05 不重开；
3. 已 Done Issue 不因为新增 AI Tier 需求而修改 implementation；
4. 不删除 Duplicate 历史；
5. 恢复 Duplicate 前确认其工作内容仍未被其他 Done Issue 实现；
6. `blockedBy` 必须指真实 engineering prerequisite，不把“同 Milestone”全部互相串行；
7. Gate 只依赖 Blocking items；
8. observational issue 不阻断 Gate；
9. H/External task 不能自动标 Done；
10. 修改 dependency 后进行 cycle check；
11. 一个 Active engineering issue 只能有一个主要 AI Tier；
12. 如果一个 Issue 仍同时需要 A 与 B 的独立工作，应继续拆；
13. 不为了减少 Issue 数把 ADR/security/recovery 与机械 UI 再合并；
14. 不为了 AI 调度把一个正常 coherent PR 拆成文件级碎票。

---

# 36. 推荐的 WU 文档组织

建议 WU 独立维护：

```text
docs/work-units/
  Rhiza_WorkUnits_M06_V1.0_20260902.md
  Rhiza_WorkUnits_M07_V1.0_20260902.md
  ...
```

但只对：

- 当前 Milestone；
- 下一 Milestone；

保持 fully detailed。

远期 WU 不提前生成，避免随着 repository baseline 变化快速腐烂。

WU 文件必须记录：

```yaml
id:
milestone:
tier:
issues:
requires:
frozen_inputs:
entry_checks:
exit_checks:
```

不要复制 Issue 的完整 Scope/Acceptance，避免双重 source of truth。

---

# 37. Ready 判定

一个 Issue 只有满足全部条件才可加：

```text
Dispatch·Ready
```

Checklist：

- [ ] `Required AI Tier` 已标；
- [ ] blocker 全 Done；
- [ ] Frozen Inputs 已 accepted；
- [ ] repository baseline green；
- [ ] Scope / Out of Scope 明确；
- [ ] unit acceptance 可立即运行；
- [ ] 不依赖 future Issue 才判断对错；
- [ ] change-control 触发条件明确；
- [ ] 无未解决架构/产品关键问题；
- [ ] 预计形成 coherent PR；
- [ ] 需要的外部环境当前可用；
- [ ] 若涉及 UI：视觉 fixture/viewport 已冻结，浏览器截图可生成，视觉模型验收规则已定义。

否则：

```text
Dispatch·Blocked
```

---

# 38. Milestone Ready 判定

允许用户直接执行：

```text
完成 Mxx
```

之前，Milestone 应满足：

- [ ] 所有 Active engineering issues 都 dispatchable；
- [ ] dependency DAG 无环；
- [ ] 不存在 Tracking-only issue 被当作工程工作；
- [ ] External evidence 明确标出；
- [ ] Final Gate 依赖完整；
- [ ] max required tier 可计算；
- [ ] 每张 Issue 都有 unit acceptance；
- [ ] 至少一次 dry-run 能生成合法执行顺序；
- [ ] 含 UI 的 Milestone Gate 已纳入关键视觉状态抽查，而非只看功能测试。

如果不满足，应返回：

```text
MILESTONE_NOT_DISPATCH_READY
```

并列出缺失项，而不是让 Agent 自己猜施工顺序。

---

# 39. 二次工程审计结论与硬修正

本次 `$think-twice` 按“B/C 模型是否会被迫自行补需求/设计”重新审查后，确认以下修正是必要的：

1. **M06**：ContextEnvelope 必须消费已经冻结的 ModelSpec/ProviderEndpoint identity；execution_runs schema 必须再消费 ContextEnvelope contract。原并行顺序过松。
2. **M07**：layout_nodes 使用 ObjectRef，因此 Layout implementation 不能只依赖 ADR，还应依赖 workspace_objects Registry。
3. **M08**：cache invalidation implementation 不能只依赖抽象层 contract；它应在 candidate index 与 Manifest schema 已存在后施工，避免 B 模型猜 index/version/ref 细节。
4. **M16 Provider**：`global vs per-workspace` 是 ownership/persistence 决策，不应隐藏在 B-tier settings 实现里；已拆为 A-tier contract + B-tier UI/实现。
5. **M16 Synthesis**：通用 synthesis 应消费已经实现/冻结的 Review/Debate 输出，而不是与模式实现并行猜测输出结构。
6. **M21**：修复“可与 M20 并行”与“必须搜索 Task”的冲突。Search Core 可并行，Task Search adapter 必须等待真实 Task contract，最终 Gate 汇合。
7. **UI 全局**：任何 UI Issue 都要求功能测试 + 视觉模型双重验收；C-tier UI 只有在视觉/交互语义完全冻结时才允许。
8. **Gate 策略**：不要求每个 Issue 都重复一整套测试。允许某些实现 Issue 用局部 unit/contract acceptance，而在 feature/milestone Gate 用完整纵切、视觉、性能或恢复 suite 统一证明；但任何 Issue 都必须至少有足以证明“本票没有明显做错且不会把未知设计留给下游”的局部 evidence。

仍需保守处理的远期任务：M25–M27 中 `NEW-*` 只是**进入该 Milestone 前的建议拆分边界**，现在不得直接当作最终 schema/API 需求写死；必须在前置 Milestone 完成后重新对 repository baseline 做 Ready audit。

---

# 40. 当前 Roadmap 的总体判断

按上述标准重新评估：

## M06–M15

总体工程分解已经较成熟。

真正需要做的是：

- 补内部 dependency graph；
- 添加 AI Tier；
- 少量修正 acceptance / frozen input；
- 基本不需要重新拆票。

其中：

- M12–M15 大量工作可以稳定交给 B-tier；
- 不应因为属于 Rhiza 核心产品，就默认全部使用 SOTA。

## M16–M24

这是最需要调整的一段。

问题不是功能规划错误，而是此前二次审计将若干独立 work packages 合并，导致：

- mixed cognitive tier；
- 单票 scope 过大；
- 一个 PR 边界不清；
- dispatch 时容易让 A-tier 做大量 B-tier 工作。

好消息是很多被拆掉的票仍作为 Duplicate 保存在 Linear，可以低成本恢复。

## M25–M27

原则已经足够清晰，但距离实际施工尚远。

本文给出推荐 split 边界，**不建议现在就把所有 NEW issue 写入 Linear**。

进入 Workflow 阶段前应结合届时 repository 重新确认。

## M28–M32

保持 Candidate Gate 粒度是正确的。

在没有真实数据/真实使用前细拆 implementation，工程价值低且容易制造 roadmap theater。

---

# 41. 最终执行原则

这份规划最终只需要支持四条非常朴素的事实：

### 1. 一个 Issue 可以直接交给一个合适等级模型

```text
完成 INH-59
```

不需要中途换主模型。

### 2. 一个 WU 只是若干完整 Issue 的成本优化包

```text
完成 WU-M07-B2
```

不重新定义任务。

### 3. 一个 Milestone 可以作为简单用户命令

```text
完成 M07
```

但内部是多次受控 execution，不是一个连续数周 agent session。

### 4. 后续实现可以推翻上游假设，但不能隐式推翻

任何需要修改 Frozen Contract 的情况必须显式进入 change-control，并重新验证真实受影响范围。

---

# 41. 建议下一步

如果要把本文落入实际开发流程，最合理的第一步不是一次性重写整个 Linear，而是：

```text
Pilot = M06 + M07
```

对这两个 Milestone：

1. 加 AI Tier；
2. 写 Frozen Inputs / Must Not Change；
3. 补完整 blocker DAG；
4. 验证每个 Issue 的 unit acceptance；
5. 生成 M06/M07 WU manifest；
6. 实际尝试：
   - `完成一个 B-tier Issue`
   - `完成一个 A-tier Issue`
   - `完成一个 WU`
   - `完成一个 Milestone macro`
7. 记录：
   - 返工率；
   - contract-change 频率；
   - context 重建成本；
   - acceptance 首次通过率；
   - A/B tier 误判；
   - 实际 token / 时间 / reviewer 成本。

如果这个简单层级不能稳定工作，不应继续开发更复杂的 dispatcher。

如果它能稳定工作，再把同一规范滚动应用到后续 Milestones。

---

## Appendix A · 建议写入 Linear 的新增 Issue 清单

当前本文明确建议未来新建的 Issue 只有：

```text
NEW-M25-PRODUCT
NEW-M26-SCHEDULER
NEW-M26-REASSIGN
NEW-M26-PERMISSION
NEW-M26-RECONCILIATION
NEW-M27-AUTOLOOP
NEW-M27-QUALITY
NEW-M27-CONVERGENCE
NEW-M27-PRODUCT
NEW-M27-EVIDENCE
```

其中：

- M25 新票：进入 M25 前确认；
- M26/M27 新票：**现在不应写入 Linear**，只作为未来 decomposition proposal。

优先复用的 Duplicate Issues：

```text
INH-277
INH-272
INH-273
INH-141
INH-143
INH-140
INH-145
INH-161
INH-163
INH-197
INH-276
INH-167
INH-169
INH-173
INH-175
INH-179
INH-180
INH-186
INH-185
INH-52
INH-188
```

恢复前必须重新读取实时 Linear 状态并检查是否已经由其他 Issue 完成。

---

## Appendix B · 推荐 AI Tier 标签说明

### AI·A-SOTA

```text
Required when:
- unresolved high-cost contract decision
- security/permission boundary
- concurrent state/recovery/fencing
- irreversible migration/purge
- cross-module invariant
- workflow/multi-agent convergence semantics
```

### AI·B-Strong

```text
Required when:
- contract frozen
- module-level implementation
- API/UI/product integration
- deterministic migration
- benchmark/performance implementation
- ordinary recovery with objective tests
```

### AI·C-Fast

```text
Required when:
- no open semantic decision
- mechanical wiring/cleanup
- fixtures/docs/simple tests
- objectively checkable local change
```

### AI·H-External

```text
Required when:
- real user evidence
- observation window
- unavailable physical/CI environment
- external approval/data source
```

---

## Appendix C · 重要反例

### 反例 1：把 Milestone 当一个长 agent session

错误：

```text
M07 = 一个 agent 连续自主工作 6–9 工程周
```

正确：

```text
M07 = 一个用户命令
     + 多个 clean execution runs
     + Issue/WU checkpoints
     + final gate
```

### 反例 2：冻结意味着永不改设计

错误：

```text
INH-55 Done
=> ObjectRef 永远不能修改
```

正确：

```text
INH-55 accepted
=> downstream 不能隐式修改
=> 如有真实缺陷，显式 contract revision + impact revalidation
```

### 反例 3：所有复杂代码都交给 SOTA

错误：

```text
代码很多 / 标签“难度·极高”
=> A-tier
```

正确：

```text
contract frozen + tests objective
=> 很多复杂实现仍可以 B-tier
```

### 反例 4：为了省票把所有工作包重新塞进 umbrella

错误：

```text
ADR + schema + migration + UI + recovery
= 一个 Issue
```

如果这些部分认知等级、修改范围、验收边界不同，应拆。

### 反例 5：WU 成为第二套 Roadmap

错误：

```text
Linear 有一套任务
WU 又复制一套任务描述/acceptance/状态
```

正确：

```text
Linear = WBS truth
WU = issue references + order + tier + entry/exit checks
```

---

**End of document**
