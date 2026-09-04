# Rhiza AI 协作者与认知状态：潜在开发方向

> Status: Research Backlog / Future Direction  
> Version: V0.2  
> Date: 2026-08-27  
> Scope: 本文记录关于 AI 协作者、Scope Cognition、长期记忆、Reasoning State、Mind 等方向的完整讨论、五模型独立评审结果与验证计划。本文不是当前 V4.2 架构基线，不要求修改现有架构与路线图；任何新机制必须通过实验获得增量价值证明后，才有资格进入正式架构。

---

## 0. 当前结论

本轮讨论最终没有形成“立即实现一套认知操作系统”的结论，反而形成了一个更严格的工程判断：Rhiza 应先完成其基本产品能力，即稳定的 Conversation Flow、Branch/Temp Chat、Graph Context Control、Context Selection 与可追溯 Context Manifest；只有这些基础能力可以真实使用之后，才有条件验证更高级的 Scope Cognition、Decision State、Typed Memory、Reasoning Git、Mind 等构想。

经过 Gemini 3.5 Flash、DeepSeek V4 Flash、Claude Opus 5、豆包 2.1 Turbo 与 Grok Fast 五组独立评审后，当前判断进一步收敛为两条轨道：

```text
Rhiza Kernel / Durable Infrastructure
    ↓
继续按既有产品需求推进

Cognitive Layer / Research Hypotheses
    ↓
必须逐层实验获得存在资格
```

Kernel 层包括 Conversation / Workspace State、Branch/Graph、Context Selection、Context Manifest / Provenance、Execution/Run Durability、基础检索与投影等已经具有独立工程价值的能力。即使未来证明 Scope Cognition、Mind 或 Semantic Merge 没有必要，这些能力仍然服务于 Rhiza 的长期对话、上下文控制、多 Agent、Harness、工作流与可观测性目标，因此不能因为 Cognitive Layer 受到质疑而反向推翻。

Cognitive Layer 则包括自动 Scope 判断、自动 Memory Writing、复杂 Typed Memory、后台 Consolidation、Semantic Merge / Rebase、Mind、多 Mind Debate 等。它们当前都属于 hypothesis，不应反向驱动 Kernel 提前增加架构复杂度。

当前最重要的原则是：

> Complexity must be earned by measured failure of the simpler layer.
>
> 每一层新增复杂度，都必须由上一层更简单方案的可测失败来证明其必要性。

近期开发主线仍然是 Rhiza 的基础对话流与 Graph 上下文控制。完成这一基础后，应优先建立质量 benchmark、运行消融实验，再由数据决定 Cognitive Layer 是否以及应当演进到什么程度。

## 1. 问题起点：为什么 AI 仍然更像“更智能的搜索引擎”

当前大多数 AI 助手虽然具备很强的推理、检索、生成和执行能力，但在长期协作中仍然表现出明显的“局部响应式”特征：模型倾向于优先响应用户最新一句话，而不是持续维护整个讨论或项目的目标、边界、约束和推理主线。

典型表现包括：

- 用户提出一个方案后，AI 默认进入“好的，我会……”式执行，而不是先判断方案是否成立、是否值得做、是否偏离已确认目标。
- AI 会随着用户当前输入不断发散，每一步局部上都合理，但整个讨论逐渐偏离最初目标。
- 长对话中已经确认的原则、否决过的方案、约束和可行性判断逐渐失去作用。
- AI 很少主动说“这个方向值得讨论，但不属于当前主线”或“我们先回到刚才尚未解决的问题”。
- 长期记忆可以让模型“记得一些信息”，但不等于模型持续拥有一套前后连贯的认知状态。

这使得当前 AI 很容易做到 helpful，却不一定 useful：它能很好地回答当前问题，却未必能让整个协作过程朝正确方向前进。

因此可以把 AI 助手粗略分成两种产品形态。

第一类是 Tool Agent。它面向机械性或目标明确的任务，核心指标是可靠执行、速度、工具调用、格式正确性和 instruction following。此时 AI 应尽量少拥有“主动意见”。

第二类是 Cognitive Collaborator。它面向长期、复杂、含大量不确定性的工作，除了执行，还必须具备判断、反驳、范围控制、目标一致性、长期决策维护和主动引导能力。

这里所说的“性格”并不是 personality/persona 意义上的人设，而更接近稳定的判断主体性：同一个协作者应能跨轮次保持相对一致的原则、经验、风险偏好、异议阈值和目标理解。

---

## 2. 一个合格 AI 协作者需要的三种“刹车”

### 2.1 事实刹车

当用户的事实前提错误时，AI 应明确纠正，而不是沿错误前提继续推演。

### 2.2 可行性刹车

AI 应区分：

- 技术上能否实现；
- 当前团队、时间、成本、维护能力下是否值得实现。

很多 AI 会把 feasibility 退化成 technical possibility，只要技术上能做就继续展开，最终帮助用户构造一个理论上漂亮但工程上不可完成的系统。

### 2.3 边界刹车

即使一个方向本身合理，也可能已经超出当前问题或项目 Scope。一个高级协作者应该能说：

> 这个方向有价值，但不属于当前主线；可以先记录或放到旁支，不建议现在继续展开。

这类“协作意义上的拒绝”与安全拒绝不同。它的目标不是阻止用户，而是保护有限注意力、项目主线与决策质量。

---

## 3. Scope Cognition 与 Conversation Governance

人类高级工程师在开始讨论一个复杂产品时，通常会快速形成一张粗略的全局地图：产品是什么、不是什么，核心目标是什么，资源约束是什么，哪些属于当前阶段，哪些只是远期可能性，哪些新方向会改变整个产品性质。

AI 往往缺少这种稳定的“问题边界感”。它更像边走边铺地图：用户把话题带到哪里，模型就顺势继续展开。

这造成一种典型失败模式：

> 每一步都合理，但最后已经不是原来的问题。

单纯增加 Context Window 并不能完全解决这个问题。更长上下文提高的是“信息可访问性”，但不能自动保证模型知道哪些内容是主线、哪些是旁支、哪些已经成为正式决策、哪些只是脑暴。

因此可以定义一个研究概念：Scope Cognition / Conversation Governance。

它需要持续维护至少这些信息：

```text
Project
Current Scope
Parent Scope
Current Objective
Committed Constraints
Active Decisions
Rejected Decisions
Open Questions
Deferred Topics
Existing Branches
```

但这一结构是否需要复杂系统实现，目前尚未证明。Flat State、固定 Prompt 或简易 Decision Manifest 可能已经解决大部分问题，必须先做对照实验。

---

## 4. 从“主持人 AI”到 Scope Observer

早期设想是在对话流中增加一个“主持人 AI”，负责控制话题走向、维护 Scope、识别偏离、决定是否 Fork，并维护 Reasoning State。

这一设想经过评审后发生了明显收敛。

不建议设计一个与主 Agent 平级、每轮读取完整上下文并重新推理的“第二个聊天模型”。这种方案会显著增加 Token、延迟和系统复杂度，而且会产生“谁来监督主持人”的递归问题。

更合理的方向是把它降级成一个非常薄的状态/观察层，早期甚至不应叫 Controller，而更接近 Scope Observer。

它的第一阶段职责不是自动修改状态，而是：

- 观察当前输入是否可能形成新的问题空间；
- 发现当前讨论与已有 Scope / Decision 的潜在冲突；
- 记录用户真实 Fork 行为作为未来数据；
- 必要时给出轻量提示，但不自动创建分支。

自动 Fork 面临严重的 base-rate 问题。假设一个 100 轮对话只有 5 次真正需要 Fork，即使分类器只有 5% 假阳性，也会额外制造约 4.75 次错误分支。错误分支会打断思路、切割上下文并产生额外恢复成本，因此自动状态变更需要极高特异度。

早期更合理的交互是：

```text
detect → suggest → user acts
```

而不是：

```text
detect → automatically fork
```

手动 Fork 并非完美方案，因为它的 Recall 可能较低——用户未必意识到自己已经偏离主线。因此“自动检测”仍可能有价值，但自动检测与自动执行必须分离。

---

## 5. Branch：维护主线纯净，而不是无限切碎对话

一个最直观的应用场景是：当用户提到一个不属于当前主线、但有独立价值的话题时，系统可以将其视为潜在旁支，从而避免污染主线 Context。

但是否需要 Fork 不能只依赖 Topic Similarity，而应该判断 Scope Discontinuity：

> 如果继续讨论这条输入，是否会改变当前任务的目标、决策对象或推理上下文？

可以保留一个研究上的三级模型：

- Excursion：轻微、短暂偏离，继续留在当前流。
- Side Thread：中等偏离，可暂时独立讨论。
- Persistent Branch：明显独立的问题空间。

这一分级目前不应直接做成自动行为，只可作为未来标注、数据分析与分类实验的概念框架。

---

## 6. Reasoning Git：有价值的隐喻，但不能照搬 Git 实现

本轮讨论曾将 Rhiza 类比成“Agent / Reasoning 版 Git”：Branch、Commit、Diff、Merge、Conflict、Rebase、Cherry-pick、Rollback 都有直观映射。

这一隐喻有启发性，但必须明确其边界。

Git 能可靠工作，依赖代码与文本具备相对确定的 Diff、语法约束、编译器、测试与冲突检测。自然语言推理不存在同等可靠的 Ground Truth。Semantic Merge 最大风险不是显式失败，而是 silent failure：系统合并出一份看起来合理、实际上语义错误的状态。

因此 Rhiza 真正可以借用的是：

```text
history
branch
provenance
rollback
explicit state transition
```

而不是默认借用：

```text
automatic semantic merge
rebase
cherry-pick
text-like deterministic diff
```

对于早期系统，更安全的模式可能更像 Pull Request，而不是 Git Merge：

```text
Branch Discussion
    ↓
Proposed Changes
    ↓
Add Decision / Add Constraint / Supersede State
    ↓
Review / Accept / Reject
    ↓
Main State
```

即 AI 提出 State Patch，但最终状态变更必须显式、可审计、可回滚。

Semantic Merge 当前应视为长期研究问题，而不是开发计划。

---

## 7. 长期记忆的基本模型

当前多数 AI 产品中的“长期记忆”并不是模型参数持续变化，而更接近：

```text
保存
→ 提取 / 压缩
→ 检索
→ 重新注入当前 Context
```

模型每次工作时依然主要依赖当前 Context。所谓长期记忆，本质上是系统在模型“醒来”之前准备一份 briefing。

真正困难的不是存储，而是三件事：

### Memory Writing

哪些内容值得长期保存？

### Memory Retrieval

当前到底应该取回哪些内容？

### Memory Interpretation

取回的信息在当前推理里是什么逻辑地位？

例如：

```text
我们考虑过 Electron。
```

与：

```text
Electron 已被项目级否决。
```

语义相似，但逻辑地位完全不同。

---

## 8. 类人记忆：印象、关键记忆与 Retrieval Cue

人类通常不会持续加载全部长期记忆，而会先通过某种“印象”触发针对性回忆：

```text
印象 / Cue
→ 激活相关话题
→ 定向检索
→ 更具体事件与理由
→ 当前工作记忆
```

例如一个人可能只记得：

> 这个方案以前踩过坑。

这条高度压缩的印象已经足以改变当前行为；如果决策影响较大，再进一步回忆“当时为什么踩坑”。

Rhiza 可以借鉴这一结构：平时只加载高压缩的 Key Memory Core，真正需要时再通过 provenance 回溯原始讨论。

例如：

```text
Electron
→ Project-level rejected
→ High significance
→ Current proposal conflicts
→ Retrieve original reason and revisit condition
```

---

## 9. 关键记忆不是“信息量最大”的记忆

信息熵或不可压缩性可以帮助理解一条信息包含多少新内容，但不等于未来决策价值。

一条很短的原则可能极其重要：

```text
禁止远程执行任意代码。
```

而一份几十 KB 的 Debug Log 虽然信息量很大，却可能在问题解决后几乎没有长期价值。

更合理的目标类似 Rate-Distortion：

> 在有限的记忆预算下，尽量保留那些一旦丢失就会让未来判断显著失真的信息。

因此一条高价值记忆更可能是：

```text
Decision:
Electron 被否决。

Reason:
体积与资源占用违反轻量化目标。

Revisit Condition:
只有 Native UI 无法满足核心交互需求时才重新评估。
```

同时必须保留 provenance，使压缩后的结论可以回到原始证据，而不是逐渐固化成失去背景的偏见。

---

## 10. Significance、Relevance 与 Surfacability 必须分离

这是本轮讨论中最值得长期保留的设计洞察之一。

### 10.1 Memory Significance

回答：这条信息值不值得长期保存？

潜在因素包括：

```text
决策影响
未来复用概率
约束强度
独特性
跨 Scope 影响
用户明确强调程度
重复出现程度
时效衰减
冗余程度
```

### 10.2 Retrieval Relevance

回答：当前任务是否值得取回这条记忆？

潜在因素包括：

```text
当前任务相关性
因果关系强度
Scope 一致性
当前决策影响
时间有效性
冲突可能
缺失该记忆是否显著降低回答质量
```

### 10.3 Surfacability

回答：即使这条记忆可以影响内部推理，是否应该显式告诉用户？

建议区分：

```text
use_in_reasoning = true / false
mention_to_user = true / false
```

大量记忆可以在后台影响模型判断，但没有必要显式说“我记得你以前……”；只有历史本身构成当前论据时才应该自然引用。

一个简单产品判断是：

> 如果一个真人长期合作伙伴此刻主动提起这件往事，会不会显得自然？

如果不会，就不应显式展示。

这可以避免长期记忆带来的 weird / creepy recall。

---

## 11. Memory Writing：从后台猜测改为显式候选事务

评审中最有价值的建议之一，是不要优先做复杂的后台“决定识别 + Consolidation”，而是首先验证一个显式工具：

```text
record_decision(
  decision,
  reason,
  revisit_condition
)
```

原始思路：

```text
Conversation
→ 后台模型猜测
→ Candidate Memory
→ Consolidation
→ Long-term State
```

更保守的早期方案：

```text
Conversation
→ 当场识别候选决策
→ 用户可见 / 可纠正
→ record_decision
→ Project State
```

这会把“正式决定还是脑暴”的判断放在事件发生时，而不是若干轮之后依赖模型回看历史猜测。

重大状态写入应尽量显式、可见、可撤销。

后台 Consolidation 当前应暂缓，因为它存在严重的误差正反馈风险：

```text
错误抽取
→ 写入长期状态
→ 后续模型引用
→ 再次总结
→ 错误逐渐固化为“历史事实”
```

未来若引入 Consolidation，应至少满足：

- Raw Event 永不作为派生状态被覆盖；
- Derived Memory 可撤销；
- Summary 不是 Source of Truth；
- 重大 Decision 必须保留 provenance；
- 低置信状态不能无条件 promotion；
- 错误状态应通过 supersede 纠正，而不是删除历史。

---

## 12. Decision Nucleus 优先，Typed Memory 延后

早期曾设想如下类型：

```text
principle
rule
constraint
decision
hint
fact
preference
hypothesis
episode
order
```

并为 Memory 增加 authority、scope、persistence、confidence、status、provenance、priority、revisit_condition 等字段。

经过五组评审后，当前结论进一步收敛：**不要先定义完整 ontology，先验证一个最小的 Decision Nucleus 是否已经足够。**

第一版最值得测试的高权威对象可以只有：

```text
DecisionNucleus
  claim
  status = active | rejected | superseded
  reason
  revisit_condition
  authority
  provenance
```

它解决的是当前最明确、最可验证的一类失败：

```text
“Electron 被考虑过”
≠
“Electron 已被否决”
```

如果一个高优先级 Decision Nucleus + 普通 RAG 已经可以显著降低“僵尸方案复活”“忘记否决理由”“违反既定约束”，那么没有理由预先实现十类 Memory Ontology。

Type 只有在下游行为真的不同的时候才有意义。例如：

- `active / rejected / superseded` 会直接影响检索和冲突判断；
- `revisit_condition` 决定何时允许重新讨论一个 rejected decision；
- `authority` 影响是否可以被模型自动覆盖；
- `provenance` 决定何时需要回到原始 evidence；
- 如果未来实验证明 Principle 与普通 Decision 在生命周期、更新权限或冲突处理上确实不同，Principle 才获得独立类型的工程理由。

因此第一阶段优先测试 Flat State：

```text
CURRENT_SCOPE
ACTIVE_DECISIONS
REJECTED_DECISIONS
CONSTRAINTS
OPEN_QUESTIONS
```

第二阶段只增加 Decision Nucleus 与最小逻辑状态。

只有当真实项目证明这些结构仍然无法处理状态冲突、覆盖、生命周期差异、Scope 污染或检索噪声，才逐步增加 Typed Memory。任何新增字段都必须先回答：

> 谁消费它？它会改变什么下游行为？没有它会产生什么可测失败？

如果无法回答，就不应加入 schema。

## 13. Mind：长期认知结构的研究概念

讨论中提出了一个产品概念：Mind。

Mind 不等于 Soul、Persona、Personality。它不是语气、人设或角色扮演，而是一套持续存在、可以更新、切换和版本化的认知结构。

一个潜在定义是：

```text
Agent = Model + Mind + Current Context
```

其中：

- Model：GPT、Claude、本地模型等底层推理引擎；
- Mind：长期判断结构、经验与认知状态；
- Current Context：当前任务、Scope、Branch 与 Working State。

潜在 Mind 内容包括：

```text
Mind
├── Principles
├── Rules
├── Decision Doctrine
├── Constraints
├── Knowledge State
│   ├── Facts
│   ├── Assumptions
│   ├── Models
│   └── Beliefs
├── Experience
│   ├── Episodic Memories
│   ├── Lessons Learned
│   └── Failure Memories
├── Preferences
├── Heuristics
└── Active State
    ├── Current Orders
    ├── Scope
    ├── Goals
    └── Working Hypotheses
```

不同信息应拥有不同更新速率：Principle 极慢，Rule 较慢，Heuristic 随经验调整，Fact 频繁更新，Hypothesis 快速变化，Order 通常短期存在。

但 Mind 当前只应保留为 Research Hypothesis。

要进入正式产品，至少需要证明：

1. 外部 State 本身能显著提升长期协作质量；
2. 同一 Model + 不同长期 State 能产生稳定、可解释的决策差异；
3. 这种差异能跨任务维持，而不是一次性 Prompt 风格变化；
4. 用户确实希望维护、切换或版本化不同判断体系。

在这些条件成立前，不实现 Mind。

---

## 14. 多 Mind Debate 与 Multi-Agent Theater 风险

潜在设想是允许用户维护多个 Mind，让同一模型切换不同 Mind，或者让不同 Mind 的 Agent 进行辩论。

这一机制非常容易退化为 Multi-Agent Theater：

```text
“保守派架构师”
“激进创新者”
“务实产品经理”
```

三个模型输出措辞不同、实质高度重复的意见，Token 成本成倍增加，却没有真正决策增益。

真正有价值的多 Mind 必须产生实质不同的长期 Decision Policy，例如：

```text
Mind A:
Reliability > Simplicity > Performance > Novelty

Mind B:
Iteration Speed > Simplicity > Reliability > Scalability

Mind C:
Maintainability > Ecosystem Compatibility > Performance
```

并且这些差异应来自长期状态、经验和价值排序，而不是单轮角色 Prompt。

基础事实应尽量共享 Evidence Layer，分歧主要发生在价值排序、经验解释、风险偏好与推理上。

该功能当前明确列入长期研究 Backlog，不进入近期路线。

---

## 15. 外部 AI Review Panel 的共同结论

本轮构想先后交给 Gemini 3.5 Flash、DeepSeek V4 Flash、Claude Opus 5、豆包 2.1 Turbo 与 Grok Fast 做独立批判。五者训练路线、产品取向和表达风格明显不同，但最终在最核心的问题上高度收敛。

### 15.1 最大问题不是“问题不存在”，而是“解决方案复杂度没有被证明”

五组评审都没有真正否定主线漂移、决策遗忘、Sycophancy、长期协作质量等问题本身，而是在质疑：是否真的需要 Scope DAG、完整 Typed Memory、Semantic Merge、Mind 等复杂机制。

因此应该降低对具体 Cognitive Architecture 的先验置信度，而不是降低对 Context / State Control 问题本身的重视。

### 15.2 真实基线不是朴素 Full Context

真正需要打败的基线至少应该包括：

```text
Strong Model
+ Governance Prompt
+ RAG / Existing Context Planner
+ Flat Decision / Constraint Manifest
```

“检索比 Full Context 省 Token”是 RAG 的收益，不是 Rhiza Cognitive Layer 的独特贡献。

Rhiza 真正需要证明的是：

> 在同等或接近的 Context Budget 下，显式 Decision / Logical State / Branch Isolation 是否比强模型 + Prompt + 普通 RAG + Flat Manifest 产生稳定、显著的质量增益。

### 15.3 Kernel 与 Cognitive Layer 必须解耦评价

Grok 特别指出：Rhiza 的 Workspace / Conversation State、Context Manifest、Execution/Run Durability、Graph Projection、基础 Provenance 等 Kernel 能力具有独立工程价值，其成功与否不依赖 Scope Controller、Mind 或 Semantic Merge 是否成立。

因此：

```text
“验证 Scope Cognition 不需要 Event/DAG”
≠
“Rhiza 整体不需要其现有 Kernel 能力”
```

评审 Cognitive Layer 时不能借机把已经由其他产品目标证明有价值的 Kernel 能力一起推翻；反过来也不能因为 Kernel 合理，就默认认知层同样合理。

### 15.4 Scope Controller 的误判可能直接毁掉体验

自动 Fork 尤其危险。低基础率下，即使总体准确率看起来不错，少量 False Positive 也可能产生与真实 Fork 数量相当的错误分支。

当前方向应优先是：

```text
observe → suggest → user acts
```

而不是：

```text
classify → mutate state automatically
```

因此第一阶段更准确的概念是 Scope Observer，而不是 Scope Controller。

### 15.5 Memory Writing 的高权威错误比普通漏记更危险

Background Consolidation 和自动 Decision Extraction 会产生不对称风险。

“漏掉一条普通 memory”与“把一次脑暴错误写成项目级已确认决策”不是同一类错误。后一种错误会被高优先级检索反复放大，可能逐渐成为系统自己的“历史事实”。

因此 Memory Benchmark 不能只看普通 Accuracy / Precision / Recall，还必须关注高权威错误写入的成本。

### 15.6 Git 类比只能作为设计隐喻

Git 能可靠工作依赖确定性 Diff、编译/测试等验证器以及 loud conflict。Reasoning State 没有同等可靠的验证器。

因此 Rhiza 可以借：

```text
history
branch
provenance
rollback
explicit state transition
```

但不能默认借：

```text
automatic semantic merge
rebase
cherry-pick
deterministic conflict resolution
```

Semantic Merge 最大风险是 silent failure，因此早期应该用 Proposed State Patch + Review 代替自动合并。

### 15.7 当前最缺的是“质量尺子”而不是下一版架构

五组评审最终最强的共同意见是：

> Rhiza 现在需要测量，而不是继续推演一套更完整的认知系统。

如果 Governance Prompt + Flat Decision Manifest 已经解决绝大多数问题，应接受这个结果；只有简单层失败，下一层复杂度才获得工程正当性。

## 16. 当前必须先完成的产品基础

启动本文后续任何 Cognitive Research 前，Rhiza 至少应完成一个可稳定使用的基础底座：

```text
Conversation Flow
+ Branch / Temp Chat
+ Graph Context
+ Context Selection
+ Context Manifest / Provenance
+ Basic Persistent Project State
```

同时必须明确：这一基础底座属于 **Rhiza Kernel / Durable Infrastructure**，而不是 Cognitive Layer 的附属品。

只要这些能力已经由现有产品目标驱动，并具有独立验收标准，就可以继续演进；不应因为 Scope Cognition、Mind 等研究假设受到质疑而回滚或重写它们。

Kernel 的判定标准是：

> 即使 Cognitive Layer 最终实验失败，这项能力是否仍然服务于 Rhiza 的核心对话、Context、Branch、Execution、Multi-Agent、Harness、Workflow 或可追溯性需求？

如果答案是“是”，它就是耐用资产。

当前不需要为了 Cognitive Research 提前实现：

```text
Automatic Fork
Semantic Merge / Rebase
Full Typed Memory Ontology
Background Cognitive Consolidation
Mind Runtime
Multi-Mind Debate
Dedicated Cognitive Graph Database
```

同样，也不应为了“未来可能用到”而给 Kernel 增加仅服务于这些 speculative features 的协议、表结构或抽象层。

当基础对话流与 Graph Context 达到真实可用状态后，设置一个 Cognitive Research Gate：冻结新增认知架构，进入质量 Benchmark 与消融实验。

## 17. 第一优先级：先造质量 Benchmark

在做任何新认知架构之前，需要先有一把衡量“AI 协作质量”的尺子。

建议从真实长对话与脚本化长对话两类数据构建测试集。

### 17.1 真实历史数据

从 Rhiza 自身项目长期讨论中选择有明显主线、决策变更、旁支和历史约束的长对话。

这些数据不仅用来证明“问题存在”，还应测现有 Rhiza Planner / Graph / Manifest 到底已经解决了多少问题。先量已有系统，再决定是否继续建造。

### 17.2 脚本化埋雷数据

构造 10～20 段约 50～60 轮的复杂项目对话，每段埋入若干可判定 Probe。

核心 Probe 包括：

#### Decision Violation

早期明确约束，后期提出违反它的方案。测模型是否主动指出冲突。

#### Zombie Revival

明确否决一个方案，几十轮后换一种表达重新提出。测模型是否识别这是已否决方案，而不是重新当成新提案。

#### Reason Retention

后期直接询问“当初为什么否决 X”。测理由是否正确召回，而不只是记得结论。

#### Mainline Drift

中间插入数次有价值但非主线的脑暴，再询问当前正在解决的问题。测回答与 Ground Truth 主线的一致性。

#### Irrelevant Memory Intrusion

历史中埋入语义可关联但当前无关的信息，测系统是否产生不自然的 Recall。

#### Manual Correction Count

统计用户需要重新说“我们之前决定过”“你跑题了”“回到刚才问题”的次数。

#### False Authoritative Write

故意插入 Brainstorm、Tentative Preference、错误猜测、被立即撤回的提案，观察系统是否错误 promotion 成高 Authority Decision / Constraint。

这一指标必须单独统计，因为它的失败代价远高于普通漏记。

### 17.3 成本敏感的错误度量

Memory / State 系统不应只优化普通 Accuracy。

可以先采用研究性 Cost Matrix：

```text
漏掉普通 decision                low cost
把 decision 当成 brainstorm      medium cost
把 brainstorm 当成 decision      high cost
把错误 summary 当强 constraint   very high cost
```

具体权重不应预设为产品事实，但评测必须体现错误代价不对称。

Scope 评测同理：False Positive Fork / Suggestion 的用户成本通常高于保守漏判，因此必须分别报告 Precision、Recall、Specificity 与 Base Rate，而不是只看总体 Accuracy。

### 17.4 评测注意事项

- Judge Model 可以用于自动评分，但应人工抽检争议样本；
- 测试必须固定 Model Snapshot、Sampling 参数和尽量一致的 Context Budget；
- 至少在两个明显不同的模型家族上复现，避免 Rhiza 只是在补某个模型的缺陷；
- Baseline 必须包含 Strong Model + Prompt + RAG + Flat State，而不是只和朴素 Full Context 比；
- 如果 Effect Size 很小，就不值得为此增加复杂架构；
- Token / Latency 只是一部分指标，还必须测 Human Correction Effort 与状态维护成本。

## 18. 核心消融实验：A0 / A1 / A2 / A3 / A4

这是本文最重要的下一阶段研究任务。每一臂只增加一个核心变量，避免“复杂方案一起上”导致无法知道真正产生收益的是哪一层。

### A0 — 当前 Rhiza 基线

```text
Strong Model
+ 当前已有 Context / RAG / Planner
```

目的：建立真实基线，而不是拿完全朴素聊天当假想对照。

### A1 — Governance Prompt

```text
A0
+ 约 200 Token 的 Collaboration / Scope Prompt
```

Prompt 重点包括：

- 用户事实前提不成立时明确纠正；
- 区分技术可行与当前值得；
- 检查是否偏离已确认目标；
- 发现已否决方案重新出现时指出；
- 维持当前主线与明确约束。

目的：验证最便宜的 Prompt 方法究竟能解决多少问题。

### A2 — Flat Project State

```text
A1
+ CURRENT_SCOPE
+ ACTIVE_DECISIONS
+ REJECTED_DECISIONS
+ CONSTRAINTS
+ OPEN_QUESTIONS
+ record_decision()
```

状态可以先用极简 Markdown / JSON Block 完整注入，不需要复杂数据库、向量检索或 ontology。

目的：验证“显式外部状态”本身是否比 Prompt 有显著增量价值。

### A3 — Decision Nucleus + Minimal Logical State

在 A2 基础上，只增加一个高权威 Decision Nucleus：

```text
claim
status = active | rejected | superseded
reason
revisit_condition
authority
provenance
```

并使用 provenance-aware / status-aware retrieval，使：

```text
“讨论过”
“否决过”
“仍然有效”
“已被覆盖”
```

在检索和生成时拥有不同逻辑地位。

目的：验证一个极小的高权威 Decision Object 是否已经足够，不预设完整 Typed Memory 的必要性。

### A4 — Manual Branch Isolation

```text
A3
+ 手动 Branch / Temp Chat
+ Branch-specific Context
+ 显式 Proposed State Patch
```

不实现自动 Scope Controller，不自动 Fork，不做 Semantic Merge。

分支结束后仅产生：

```text
Proposed Changes
  Add Decision
  Add Constraint
  Supersede Decision
  No Change
```

由用户或显式规则确认后才进入主状态。

目的：把“Branch Isolation 是否有价值”与“AI 是否能自动判断何时 Fork”彻底分开。如果 A4 显著优于 A3，说明分支隔离有独立价值；这仍然不能证明自动 Fork 有必要。

## 19. 预注册 Kill Criteria

必须在实验开始前写清楚什么结果会“杀死”下一层复杂度，否则项目很容易把任何结果都解释成“需要再设计一个 V5”。

建议预注册：

### 如果 A1 ≈ A2 ≈ A3 ≈ A4

说明 Governance Prompt 已解决主要问题，或者外部状态并非当前主要瓶颈。

结论：停止 Cognitive State 基础设施扩张，不进入复杂 Memory / Scope 设计。

### 如果 A1 << A2 ≈ A3 ≈ A4

说明外部 Flat State 有显著价值，但 Decision Nucleus / Typed State / Branch Isolation 没有明显增量。

结论：Rhiza 只做最简 Project State / Decision Manifest，不做复杂 ontology 或 Reasoning DAG。

### 如果 A2 << A3 ≈ A4

说明“高权威 Decision Nucleus + Logical Status + Provenance-aware Retrieval”有额外价值，而 Branch Isolation 暂时没有明显增量。

结论：允许进入最低限度 Decision State 产品化，不扩张到完整 Memory Ontology。

### 如果 A3 << A4

说明手动 Branch Isolation 对长期协作具有独立价值。

结论：保留 Branch-specific Context / Proposed State Patch；但仍然不能据此实现自动 Fork，自动 Scope Detection 需要独立数据。

### 如果所有组效果都较差

说明问题可能主要来自底层模型能力、Post-training、任务定义、用户协作方式或其他非 Context 架构因素。

结论：不要通过增加 Rhiza Cognitive Architecture 强行补偿。

## 20. 自动 Decision Extraction 的独立验证

从真实对话中抽取约 200 段潜在决策片段。

第一步不是先测模型，而是让 2～3 名人类独立标注：

> 这里是否真的产生了一个正式 Decision？

先测 Human Inter-Annotator Agreement。

如果人类之间都无法达到合理一致度，说明当前 ontology / Decision 定义本身不够明确，模型自动分类更没有意义。

在人类一致度可接受后，再测小模型 / 强模型与人工 Ground Truth 的 Precision / Recall。

但普通 Precision / Recall 仍然不够。必须额外测：

```text
False Authoritative Write Rate
```

也就是：

> 有多少 Brainstorm / Tentative Preference / 临时猜测，被系统错误写成了高权威 Active Decision / Constraint？

这项错误应设置比普通漏提取更高的失败成本，因为错误高权威状态会在后续 Context 中反复放大。

早期优先 `record_decision()`，让状态变化在发生时以 Candidate / Proposed State Patch 形式出现，而不是依赖事后后台抽取。

自动 Memory Writing 只有在“净收益”成立时才进入产品化：

```text
减少用户重复说明 / 决策遗忘的收益
>
错误高权威写入 + 审核 + 修正的总成本
```

即使自动抽取表现不错，也不意味着必须立即引入 Background Consolidation。后者需要独立验证。

## 21. Scope / Fork 不先建分类器，先埋点

Rhiza 已有手动 Branch / Temp Chat 的产品语义时，应优先把真实用户操作变成数据源。

每次用户主动创建 Branch / Temp Chat 时，记录：

```text
fork 前若干轮上下文
fork 时当前 scope / node
用户 fork 后的首条输入
分支持续长度
是否返回主线
是否产生可回流结论
```

这些数据天然构成未来 Scope Shift Detector 的真实标注。

先回答：

- 用户实际多久想 Fork 一次？
- Fork 前是否存在可检测信号？
- 哪些“偏题”最终被用户保留成独立分支？
- 哪些只是短暂 Excursion？
- 用户在哪些情况下“本应 Fork 但没有 Fork”？
- Scope Suggestion 的接受率和忽略率是多少？

只有拿到真实分布后，再讨论 Scope Classifier。

第一版 Scope Intelligence 的目标应是 `Scope Observer`：

```text
possible_scope_shift = true
confidence = ...
suggested_action = side_thread
```

它默认不拥有状态修改权。

用户接受建议本身就是高价值标注；忽略建议是弱负反馈。只有长期数据证明其 Precision / Specificity 足够高、用户接受度足够稳定时，才讨论更高自动化权限。

## 22. 后续分层验证路线

在 A0～A4 之后，如果数据支持继续，可以采用严格渐进路线。

### Level 0 — Base Conversation / Graph

稳定对话流、分支、Graph Context、Context Manifest。属于 Kernel，不依赖 Cognitive Hypothesis。

### Level 1 — Governance Prompt

最低成本的协作行为约束。

### Level 2 — Flat State

人工/模型显式维护 Decision / Constraint / Scope。

### Level 3 — Decision Nucleus

只增加：

```text
claim
active / rejected / superseded
reason
revisit_condition
authority
provenance
```

验证高逻辑地位信息是否显著优于 Flat State。

### Level 4 — Manual Branch Isolation

Branch-specific Context + Proposed State Patch，不自动 Fork。

### Level 5 — Scope Observer

检测潜在 Scope Shift，只观察或建议，不自动改变状态。

### Level 6 — Semi-auto Memory Writing

只有 False Authoritative Write Rate、Precision / Recall 和 Human Correction Cost 达标后，才提高自动写入程度。

### Level 7 — Advanced Typed Memory / Consolidation

只有真实项目规模证明 Decision Nucleus 不够时，再研究 Significance、Relevance、Decay、更多类型和 Background Consolidation。

### Level 8 — Mind

只有长期 State 差异被证明稳定改变 Agent 决策行为后，才研究可切换 Mind。

### Level 9 — Multi-Mind / Semantic State Research

长期研究问题。Semantic Merge / Rebase / Multi-Mind Debate 当前没有开发承诺，并且需要额外的验证器、人工 Review 或其他安全机制。

## 23. Token、延迟与维护成本的当前判断

此前的初步工程估算是：

| 方案 | 额外 Token | 延迟 | 当前判断 |
|---|---:|---:|---|
| 双完整 Agent 每轮审查 | +80%～120% | 高 | 不推荐 |
| 每轮小模型主持 | +15%～40% | 中 | 偏重 |
| 规则/检索优先，灰区调用模型 | +5%～20% | 低～中 | 可能可行 |
| 后台 Consolidation | 在线成本低，但总成本未知 | 在线低 | 暂缓 |

这些数字目前只是工程估算，不是性能承诺。

尤其需要注意：在线额外 Token 很小，不代表总成本小。后台抽取、矛盾检测、显著性评分、重复 Consolidation 可能反超在线节省；Scope 灰区的真实频率也尚未测量。

因此任何成本结论必须通过真实长期任务 Benchmark 验证。

长期而言，如果高质量 State / Retrieval 能把几十万 Token Full History 替换成几千 Token 高相关 Context，理论上可能降低总 Context 成本；但这是 Context Management / RAG 的共同收益，不能自动算作 Rhiza Cognitive Architecture 的独特贡献。

真正需要证明的是：Rhiza 的状态结构是否比“普通 RAG + 决策清单”提供额外质量收益。

---

## 24. 当前最值得保留的设计洞察

即使后续实验最终证明复杂 Cognitive OS 没必要，以下洞察仍值得保留：

1. Significance 与 Retrieval Relevance 是两个不同问题；“重要”不等于“现在应该取回”。
2. `use_in_reasoning` 与 `mention_to_user` 应分离，避免 Weird Memory Recall。
3. 压缩结论必须保留到原始 Evidence 的 provenance；但 provenance 只能让错误可追查，不能自动阻止错误传播。
4. 记忆价值更适合定义为“丢失后造成多少未来决策失真”，而不是单纯信息熵。
5. 不同知识具有不同生命周期和更新速率，不能简单采用“最新覆盖旧状态”。
6. 自动 Scope Detection 与自动状态修改必须分离；第一阶段应是 Scope Observer。
7. Semantic Merge 的 silent failure 风险高，应优先使用 Proposed State Patch + Review。
8. Model / Memory / Scope 的外部化状态不能把模型自身的认知缺陷误包装成已被解决。
9. 用户明确控制的状态属于耐用资产；纯粹补偿某一代模型弱点的自动机制属于折旧资产。
10. 所有复杂机制都必须先证明比 Strong Model + Prompt + RAG + Flat State 更好。
11. Kernel 与 Cognitive Layer 必须解耦评价：认知假设失败不等于现有 Context / Execution / Provenance 基础设施无价值。
12. 完整 Typed Memory 不是默认终点；一个高质量 Decision Nucleus 可能已经覆盖主要增量价值。
13. Memory Writing 错误具有不对称成本，应重点测 False Authoritative Write，而不是只追求平均 Accuracy。
14. Branch Isolation 的价值与自动 Fork 的价值必须分别验证，不能捆绑成同一个功能假设。

## 25. 当前明确不做的事情

在基础 Conversation Flow + Graph Context 未完成、A0～A4 消融数据未返回之前，不做：

- 新一代 Cognitive Architecture 重写；
- 自动 Fork；
- Semantic Merge / Rebase / Cherry-pick；
- 完整 Memory Ontology；
- Background Cognitive Consolidation；
- Mind Runtime；
- Multi-Mind Debate；
- 专用 Cognitive Graph Database；
- 为这些研究方向重写当前 V4.2 架构书或路线图。

同时，不因为 Cognitive Layer 受到批评而回滚已经具有独立价值的 Kernel 能力。是否保留 Event / Manifest / Execution / Projection / Resource 等基础设施，应按它们服务的现有产品需求单独判断，而不是由 Scope Cognition 实验结果一票否决。

也不创建一个新的 V5 架构来容纳本文内容。

本文只作为未来潜在开发方向和研究设计保存。

## 26. 当前需要做的事情

### 当前开发阶段

继续完成 Rhiza 基础功能：

```text
Conversation Flow
→ Branch / Temp Chat
→ Graph Context
→ Context Selection
→ Context Manifest / Provenance
→ Stable Project State
```

目标是让 Rhiza 成为一个可靠、可真实使用的上下文实验平台。

这一阶段继续推进已经有独立产品价值的 Kernel 工作，但不允许 Cognitive Research 反向驱动新的重型抽象。

### 基础完成后

进入 Cognitive Research Gate：

1. 建立长期协作质量 Benchmark；
2. 用现有 Rhiza Context Planner / Graph / Manifest 跑真实基线；
3. 完成 A0 / A1 / A2 / A3 / A4 消融；
4. 预注册 Kill Criteria；
5. 至少使用两个模型家族复现；
6. 测试 Human Decision Annotation 一致度；
7. 单独测 False Authoritative Write Rate；
8. 给手动 Branch / Temp Chat 埋点，积累 Scope Shift 数据；
9. 评估 Scope Suggestion 的 Precision / Specificity / 用户接受率；
10. 根据数据决定是否进入下一层复杂度。

### 只有数据证明必要时

依次考虑：

```text
Decision Nucleus Productization
→ Scope Observer
→ Semi-auto State Patch / Memory Writing
→ Advanced Typed Memory / Consolidation
→ Mind
→ Multi-Mind / Semantic State Research
```

其中每一步都必须有明确的上一层失败证据和独立增量收益。

## 27. 对 Rhiza 产品定位的长期启发

如果这些机制最终被实验验证，Rhiza 的长期差异化可能不只是“支持分支聊天”或“拥有更长上下文”，而是：

> 管理 AI 在复杂项目中的 Context、Scope、Decision、Memory 与 Reasoning State，使模型在长期协作中维持连续、可追溯、可纠正的整体工作状态。

但如果实验显示一个简单的 Governance Prompt + Decision Manifest 已经能解决大部分问题，那么 Rhiza 应接受这个结果，将复杂研究方向保持在 Archive，而不是为了维护原始构想继续增加架构。

因此真正稳定的产品价值不是“必须拥有 Cognitive OS”，而是：

> 找到最低复杂度、最高可验证收益的 Context / State Control 机制。

---

## 28. 最终研究原则

本方向后续所有设计与实验遵循以下原则：

> 先造尺子，不先造系统。

> 先和真正的强基线比较，而不是和最弱的 Full Context Chat 比较。

> Kernel 与 Cognitive Layer 分开判断：耐用基础设施不因认知假设失败而被误删，认知假设也不能借 Kernel 的合理性获得免证资格。

> Prompt 能解决的问题，不建基础设施。

> Flat State 能解决的问题，不建 Ontology。

> Decision Nucleus 能解决的问题，不建完整 Typed Memory。

> Manual / Suggested Fork 能解决的问题，不自动改变用户状态。

> Branch Isolation 的价值与自动 Fork 的价值分别验证。

> 没有验证器的 Semantic Merge 默认不可信。

> Summary 不是 Source of Truth，原始 Evidence 与 provenance 必须保留。

> Provenance 让错误可追查，但不会自动防止错误传播。

> 高权威错误写入比普通漏记更危险，评测必须成本敏感。

> 用户对状态拥有最终控制权。

> Complexity must be earned by measured failure of the simpler layer.

## 29. 一句话总结

Rhiza 当前不应立即构建一个“AI Cognitive OS”。应先完成基本 Conversation Flow 与 Graph Context Control，并继续推进那些即使认知假设失败仍有独立价值的 Kernel 能力，把 Rhiza 做成稳定的 Context 实验平台；随后通过 Governance Prompt、Flat Project State、Decision Nucleus、Manual Branch Isolation 的严格消融实验，逐层证明更复杂机制是否真的带来长期协作质量提升。

Scope Cognition 第一阶段应是 Scope Observer，而不是自动 Governor；Memory 第一阶段应优先 Decision Nucleus 与显式 State Patch，而不是完整 Typed Ontology 与后台 Consolidation；Reasoning Git 保留 history / branch / provenance / rollback 的隐喻，但 Semantic Merge / Rebase 降级为长期研究问题；Mind 与 Multi-Mind 只有在数据证明更简单状态机制不足时，才进入正式产品架构。

最终目标不是证明“Cognitive OS 必须存在”，而是找到 Rhiza 在真实长期协作中能够持续创造增量价值的**最低必要认知复杂度**。
