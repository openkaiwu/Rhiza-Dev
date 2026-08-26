# Rhiza 多模型独立评审（Peer Review）补充开发规划书

> Status: Add-on Feature / Independent Capability  
> Version: V0.1  
> Date: 2026-08-27  
> Scope: 本文定义 Rhiza 对话流中的“多模型独立评审 / Peer Review”附加能力。该能力可作为独立模块插入现有开发主线，不要求修改 Rhiza 当前总体架构与路线图，也不应反向驱动 Kernel、Graph、Context、Execution 等核心层重构。

---

## 0. 总体结论

多模型独立评审的目标，不是把多个 Agent 常驻在每一轮对话中，也不是构建 Multi-Agent Debate 系统，而是在少数高影响、方向性决策上，允许用户主动调用多个模型基于**同一份冻结上下文**进行彼此独立的评审，再由 Rhiza 对结果做结构化综合。

它本质上更接近软件工程和学术体系中的 Peer Review：

```text
Current Decision Context
        ↓
Freeze Context Snapshot
        ↓
Dispatch to Multiple Reviewers
        ↓
Independent Review
        ↓
Cross-review / Synthesis
        ↓
Consensus / Dissent / Risks / Testable Hypotheses
        ↓
User Decision
```

该功能的核心价值是用额外 Token 成本换取更高的重大决策质量。

因此它应：

- 默认关闭；
- 用户主动触发；
- 或在 Rhiza 识别到“重大方向变化”时仅提出建议；
- 不自动消耗大量 Token；
- 不自动替用户改变项目决策；
- 不要求引入新的全局认知架构。

---

## 1. 功能目的

长期复杂项目中的高影响决策通常具有明显的不对称成本。

例如：

- 技术架构选型；
- 核心依赖替换；
- 大规模重构；
- 产品方向调整；
- 数据模型变化；
- 协议变化；
- 重大安全方案；
- 开发路线重新排序；
- 某个关键假设是否成立；
- 是否推翻此前已经 Commit 的重要 Decision。

如果这些决策判断错误，后续可能造成：

```text
几十轮错误讨论
+
数小时或数天无效开发
+
大量返工
+
技术债
+
团队认知偏差
```

相比之下，在决策点额外消耗 3～5 个模型调用的 Token，成本通常是可接受的。

因此本功能的原则是：

> 用有限的额外推理成本，购买重大决策上的认知冗余。

---

## 2. 非目标

本功能明确不做以下事情：

- 不在每轮对话中默认调用多个模型；
- 不做多个 Agent 的持续群聊；
- 不让 Reviewer 相互看到彼此答案后再发言；
- 不通过多数票自动决定“正确答案”；
- 不替代用户最终决策权；
- 不要求实现 Mind；
- 不要求实现 Semantic Merge；
- 不要求实现自动 Scope Controller；
- 不要求建立完整 Multi-Agent Orchestration 平台；
- 不要求修改现有 Rhiza 核心架构；
- 不把不同模型包装成“保守派 / 激进派 / 乐观派”式角色扮演。

Peer Review 的价值来自：

```text
Independent Model
+
Independent Reasoning
+
Same Evidence
+
Structured Comparison
```

而不是不同 Persona。

---

## 3. 核心使用场景

### 3.1 用户主动发起评审

用户在当前对话节点点击：

```text
Peer Review
```

然后选择若干模型，例如：

```text
GPT
Claude
Gemini
DeepSeek
Kimi / GLM / Grok
```

系统冻结当前评审上下文，并将相同任务分发给这些模型。

这是第一阶段最核心的交互。

---

### 3.2 Rhiza 建议进行评审

未来可以在检测到高影响状态变化时，以非侵入方式提示：

> 当前讨论可能正在改变一个项目级核心决策，是否发起独立评审？

典型触发信号包括：

- Project-level Decision 被推翻；
- 关键 Constraint 被修改；
- 大规模架构重构；
- 路线图发生明显变化；
- 多项 Active Decision 同时受到影响；
- 用户准备采用高成本、难回滚方案；
- 当前方案与多个既有决策发生冲突。

第一版只需要支持用户主动触发。

“系统建议评审”属于后续增强，不应成为 MVP 前置依赖。

---

## 4. 评审上下文冻结

Peer Review 最重要的技术要求之一，是所有 Reviewer 必须基于**同一份 Context Snapshot**工作。

否则无法公平比较模型，也无法保证不同意见确实来自模型判断差异，而不是输入差异。

建议直接复用现有 Context Manifest / Context Selection 能力。

一次评审创建：

```text
ReviewContextSnapshot
```

至少记录：

```text
review_id
source_node_id
context_manifest_id
current_user_question
project_state_snapshot
selected_resources
decision_state_snapshot
created_at
```

如果当前 Rhiza 已经有不可变 Context Manifest，则不需要设计新的 Context 系统，只需要引用现有 Manifest。

原则：

> Review Session 只引用冻结后的 Context，不在 Reviewer 执行期间动态漂移。

---

## 5. Reviewer 独立性

Reviewer 之间必须严格隔离。

错误实现：

```text
Reviewer A
↓
Reviewer B 看到 A 的答案
↓
Reviewer C 看到 A+B
```

这会形成严重 Anchoring / Herding。

正确实现：

```text
             ┌→ Reviewer A
Context ─────┼→ Reviewer B
Snapshot     ├→ Reviewer C
             ├→ Reviewer D
             └→ Reviewer E
```

每个 Reviewer：

- 收到相同 Context Snapshot；
- 收到相同核心 Review Task；
- 不看到其他 Reviewer 输出；
- 独立完成；
- 结束后再进入 Synthesis。

---

## 6. Reviewer Prompt 设计

第一版建议提供两种模式。

### 6.1 Same Prompt Mode

所有模型收到完全相同的评审任务。

适合：

- 模型能力横向比较；
- 重大架构评审；
- 对相同问题进行独立判断；
- 为 Personal Capability Model 收集干净数据。

示例：

```text
独立审查当前方案。

不要默认当前方案正确，也不要因为设计完整而认可它。

重点检查：
1. 错误或未经验证的前提；
2. 更简单的替代方案；
3. 过度设计；
4. 实现中最可能失败的部分；
5. 必须先验证的核心假设；
6. 最小且最有信息量的验证方案。

请给出明确结论和理由。
```

---

### 6.2 Method-diverse Mode

多个 Reviewer 共享同一 Evidence，但采用不同的审查方法。

例如：

```text
Reviewer A:
寻找错误前提与不可证伪假设

Reviewer B:
寻找最简单替代方案

Reviewer C:
审查工程复杂度、成本与维护风险

Reviewer D:
审查产品价值与用户行为假设

Reviewer E:
自由独立评审
```

这比 Persona-style Debate 更有价值，因为差异来自分析任务，而不是“人设”。

第一版可以只实现 Same Prompt Mode。

---

## 7. Review Result 数据结构

每个 Reviewer 输出应保存为独立结果对象：

```text
ReviewResult
```

建议字段：

```text
id
review_session_id

model_spec
provider_endpoint
model_claim

context_manifest_id
review_prompt_version

raw_output

started_at
completed_at

token_input
token_output
latency
cost_estimate

status
error
```

如果 Rhiza 已有 ExecutionRun / ModelSpec / ProviderEndpoint 体系，应直接复用，不重复建设新的运行时抽象。

---

## 8. Synthesis：不是投票，而是分解观点

Peer Review 最容易犯的错误，是：

```text
5 个模型
→ 3 个同意
→ 所以这个结论正确
```

这不成立。

模型之间可能共享训练数据、认知偏差和常见错误；少数意见也可能是最关键的洞察。

因此 Synthesis 应进行观点分解，而不是简单多数票。

建议输出：

### Consensus

多个 Reviewer 独立收敛的判断。

### Repeated Risk

多个 Reviewer 分别发现的相似风险。

### Unique Insight

只有一个 Reviewer 提出，但逻辑或证据充分的重要观点。

### Conflict

Reviewer 之间存在实质矛盾的判断。

### Unsupported Claim

Reviewer 提出但缺乏当前 Context / Evidence 支持的断言。

### Testable Hypothesis

可以通过实验解决，而不需要继续争论的问题。

### Recommended Action

综合后的行动建议，但保留 Dissent。

### Dissent

明确保存未被最终推荐吸收的重要反对意见。

---

## 9. Synthesis Prompt

建议 Synthesis 层收到：

```text
Frozen Context Summary
+
Review Task
+
All Review Results
```

而不是重新读取整个项目历史。

目标不是重新独立回答问题，而是：

```text
Compare
Decompose
Resolve obvious misunderstandings
Preserve dissent
Extract testable claims
Recommend next action
```

推荐 Prompt 原则：

> 不按照多数票决定结论。优先判断各观点的论证质量、证据支持程度、是否提出独立信息以及是否可通过实验验证。少数但充分论证的观点必须保留。

---

## 10. 用户交互设计

建议第一版保持极简。

### 10.1 发起评审

当前 Conversation Node 提供：

```text
Peer Review
```

用户点击后选择：

```text
Reviewers:
[✓] Claude
[✓] GPT
[✓] Gemini
[ ] DeepSeek
[ ] Grok

Mode:
● Same Prompt
○ Method-diverse

Budget:
Estimated token / cost
```

然后明确点击：

```text
Start Review
```

系统不得未经确认自动产生多模型成本。

---

### 10.2 评审进行中

UI 显示：

```text
Claude      Complete
GPT         Running
Gemini      Complete
DeepSeek    Failed / Retry
```

用户可以提前结束部分 Reviewer。

---

### 10.3 评审结果

推荐使用三层视图：

```text
Synthesis
↓
Reviewer Comparison
↓
Raw Reviewer Output
```

默认先看综合结论。

用户需要时再展开每个模型的原始报告。

---

## 11. 与 Conversation Graph 的关系

Peer Review 可以自然映射到现有 Graph，而无需改变 Graph 架构。

逻辑上：

```text
Current Node
   │
   ├── Review A
   ├── Review B
   ├── Review C
   └── Review D
          ↓
      Synthesis
```

但第一版甚至不要求这些 Reviewer 显示为普通用户 Branch。

可以把整个 Review Session 作为一种特殊附属对象：

```text
ConversationNode
      │
      └── ReviewSession
             ├── ReviewResult
             ├── ReviewResult
             ├── ReviewResult
             └── ReviewSynthesis
```

这样不会污染普通对话树。

如果未来希望用户把某一 Reviewer 继续展开成独立讨论，可以提供：

```text
Continue as Branch
```

将指定 Review Result 转为正式 Conversation Branch。

---

## 12. 与 Context 系统的关系

本功能应尽量只消费现有 Context 能力。

依赖：

```text
Context Selection
Context Manifest
Resource Reference
Current Project State
```

新增的只是：

```text
ReviewContextSnapshot
```

如果现有 ContextManifest 已经不可变且具备 provenance，则甚至可以直接：

```text
ReviewContextSnapshot = ContextManifest Reference
```

因此无需为了 Peer Review 改造 Context Planner。

---

## 13. 与模型路由体系的关系

如果 Rhiza 已有或未来拥有：

```text
ModelSpec
ProviderEndpoint
ExecutionRun
RoutingDecision
ObservedCapabilityProfile
```

Peer Review 应直接复用。

第一阶段允许用户手动选 Reviewer。

未来 Adaptive Router 可以提供：

```text
Recommended Review Panel
```

例如：

```text
Architecture Review:
Claude / Official
GPT / Official
DeepSeek / Provider A
Gemini / Official
```

推荐理由可能考虑：

```text
reasoning
coding
long_context
stability
cost
review diversity
```

但自动选择仍然需要用户确认。

---

## 14. 成本控制

Peer Review 是明确的高 Token 功能，因此成本必须可见。

发起前显示：

```text
Estimated Input Tokens
Estimated Output Tokens
Estimated Cost Range
Reviewer Count
```

建议支持三档预算：

### Quick Review

```text
2 Reviewers
Short Output
```

适合快速二次确认。

### Standard Review

```text
3 Reviewers
Normal Output
```

默认推荐。

### Deep Review

```text
4–5 Reviewers
Detailed Output
```

用于重大方向决策。

第一版无需复杂预算算法，只需要根据 Context Token、模型价格与 max output 做简单估算。

---

## 15. 失败与降级处理

多模型评审天然会出现：

- 某个 Provider 超时；
- 某个模型返回错误；
- 某个 Endpoint 限流；
- 某个 Reviewer 输出格式异常。

Review Session 不应因为一个模型失败而整体失败。

例如：

```text
Claude     Complete
GPT        Complete
Gemini     Timeout
DeepSeek   Complete
```

系统仍然可以基于三个成功结果完成 Synthesis，并明确显示：

```text
3 / 4 reviewers completed
```

Reviewer Result 必须可独立 Retry。

---

## 16. 评审质量与 Anti-Theater 原则

为了避免 Multi-Agent Theater，应遵循：

1. Reviewer 彼此隔离；
2. Same Context；
3. 不要求“扮演人格”；
4. 不使用多数票自动决策；
5. 保存少数意见；
6. 原始输出可追溯；
7. Synthesis 与 Reviewer 分离；
8. 用户最终决定；
9. 对高影响结论尽量要求 Evidence / Reason；
10. 如果不同 Reviewer 只是重复同义内容，应在 Synthesis 中压缩，而不是扩大篇幅。

---

## 17. 与 Benchmark / Model Intelligence 的潜在协同

Peer Review 还有一个独立的长期价值：

> 它天然产生高质量的真实工作模型比较数据。

一次 Review Session 中：

```text
Same Task
+
Same Context
+
Different Model / Endpoint
```

这构成非常干净的横向样本。

如果再记录：

```text
用户最终采纳哪一条建议
用户修改了哪些建议
哪个 Reviewer 提出了最终被证明正确的风险
后续 Decision 是否采用
```

则可以形成：

```text
Review Performance Signal
```

长期用于：

```text
ObservedCapabilityProfile
Personal Capability Model
Adaptive Routing
```

这比单纯公开 Benchmark 更接近用户真实工作能力。

但这一能力属于附加收益，不应成为第一版实现前提。

---

## 18. 技术实现建议

推荐新增一个独立模块：

```text
PeerReviewService
```

职责：

```text
createReviewSession()
freezeContext()
dispatchReviewers()
trackReviewerRuns()
generateSynthesis()
persistResults()
```

建议数据模型：

```text
ReviewSession
ReviewResult
ReviewSynthesis
```

其中所有模型执行仍走现有 Execution / Runtime Adapter。

架构关系：

```text
Conversation / Graph
       │
       ↓
PeerReviewService
       │
       ├── ContextManifest
       │
       ├── ExecutionRuntime
       │
       ├── ModelProvider
       │
       └── ReviewStore
```

不新增新的 Agent Runtime。

不新增新的 Event System。

不新增新的 Context Engine。

---

## 19. API 草案

### 创建评审

```text
POST /api/reviews
```

输入：

```json
{
  "sourceNodeId": "...",
  "reviewerEndpoints": ["...", "...", "..."],
  "mode": "same-prompt",
  "reviewPrompt": "...",
  "maxOutputTokens": 4000
}
```

---

### 查询评审状态

```text
GET /api/reviews/:id
```

---

### 重试单个 Reviewer

```text
POST /api/reviews/:id/results/:resultId/retry
```

---

### 生成 / 重新生成综合报告

```text
POST /api/reviews/:id/synthesis
```

---

### 将 Reviewer 结果继续为 Branch

```text
POST /api/reviews/:id/results/:resultId/branch
```

以上均为概念接口，不要求当前 API 风格必须采用 REST。

---

## 20. 第一版开发范围

### 必须实现

```text
用户主动触发
↓
选择 2～5 个 Reviewer
↓
冻结相同 Context
↓
并行独立调用
↓
保存结果
↓
统一 Synthesis
↓
查看 Raw Output
```

同时必须支持：

- Token / Cost 预估；
- Reviewer 失败不影响其他 Reviewer；
- Retry；
- 用户可取消；
- Context Snapshot 可追溯。

---

### 第一版明确不做

```text
自动推荐 Peer Review
自动选 Reviewer
Method-diverse Panel 自动生成
Reviewer 之间互相反驳
多轮 Debate
Automatic Decision Commit
Mind Integration
自动 Scope-trigger
复杂 Reviewer Reputation
复杂 Review Quality Model
```

---

## 21. 后续增强方向

如果第一版验证有价值，可以依次增加：

### V1.1 — Review Templates

```text
Architecture Review
Product Review
Risk Review
Security Review
Cost Review
Research Review
```

---

### V1.2 — Method-diverse Review

自动生成不同方法论 Reviewer。

---

### V1.3 — Review Suggestion

当项目产生重大状态变化时，Rhiza 提示：

```text
This may benefit from independent review.
```

但不自动启动。

---

### V1.4 — Capability-aware Panel

根据 ObservedCapabilityProfile 推荐 Reviewer 组合。

---

### V1.5 — Review-derived Benchmark

把 Review Session 作为真实工作 Benchmark 样本。

---

### V1.6 — Review-to-Decision Patch

Synthesis 可以生成：

```text
Proposed Decision Changes
```

但仍需用户显式 Review / Accept。

---

## 22. 验收标准

第一版功能达到可用标准，应满足：

### Context 一致性

所有 Reviewer 使用同一 Context Manifest。

### Reviewer 独立性

任一 Reviewer 不可访问其他 Reviewer 输出。

### Failure Isolation

任一模型失败不会导致整个 Review Session 丢失。

### Traceability

用户可以追溯：

```text
哪个模型
哪个 Endpoint
使用了哪个 Context
用了什么 Review Prompt
产生了什么原始输出
```

### Cost Transparency

发起前能够看到合理的成本估算。

### Synthesis Integrity

综合结果至少明确区分：

```text
Consensus
Unique Insight
Conflict
Testable Hypothesis
Recommended Action
Dissent
```

### User Control

系统不得自动替用户接受某项 Reviewer 建议。

---

## 23. 产品验证指标

上线后重点观察：

```text
Review Session 使用频率
平均 Reviewer 数
用户是否阅读 Raw Review
用户是否修改 Synthesis
Review 后 Decision 改变比例
Review 后返工率
用户主动再次调用比例
每次 Review 平均 Token / Cost
用户是否认为 Review 值得其成本
```

一个非常重要的价值指标是：

> 用户在高影响决策上是否愿意主动再次购买这种额外认知成本。

如果用户只体验一次就不再使用，则说明该功能可能只是“看起来高级”。

---

## 24. 与 Rhiza 当前开发路线的关系

该能力定义为独立 Add-on Feature。

它不要求：

- 修改当前 V4.1 总体架构；
- 修改核心开发路线；
- 提前实现 Mind；
- 提前实现 Scope Cognition；
- 提前实现 Typed Memory；
- 提前实现 Semantic Merge；
- 重构 Conversation Graph；
- 重构 Context Planner。

只要当前系统具备：

```text
Conversation Node
Context Manifest
Multiple Model / Provider Access
ExecutionRun / Model Invocation
Basic Persistence
```

就可以开始实现。

因此它可以在任意合适 Milestone 中插入，也可以作为独立 Feature Branch 开发。

原则：

> Add the feature to Rhiza; do not redesign Rhiza around the feature.

---

## 25. 一句话定义

> Rhiza Peer Review 是一种面向重大决策的按需多模型独立评审机制：多个模型基于同一冻结上下文独立判断，Rhiza 保留共识、异议和独立洞察，再由用户做最终决策。

它不是常驻 Multi-Agent Debate，而是：

> 为高影响决策主动购买额外认知冗余。
