# Rhiza M07 Sidejob Patch — UI Seam Hardening

```text
Document Type: Milestone Sidejob Patch
Version: V0.1
Date: 2026-09-02
Target Baseline: Rhiza 开发路线图 V4.2 / Rhiza 技术架构设计书 V4.2
Target Milestone: M07 — Workspace Graph Projection v1
Status: Partially adopted; M07 remains unstarted
Priority: P2 / Non-blocking enabling work
```

> 本 Patch 不修改 M07 的主目标、Blocking Acceptance、Domain 语义或路线依赖。
>
> 目的只有一个：在 M07 已经需要触碰 Graph Projection、layout projection、bounded API 与前端 Graph 消费方式的过程中，顺手建立少量稳定 UI seam，降低后续 M12–M18 多轮 UI / 信息架构调整的累积成本。
>
> **M07 不负责设计最终 UI；M07 只负责确保当前 UI 将来可以被低成本推翻和重组。**

> 2026-09-02：`AppShell`、`graph-model` 与按 surface 划分的 CSS 已随 UI 修复独立落地；这不构成 M07 开始或完成，也不替代 M07 的 Projection / bounded API / rebuild 验收。其余 Sidejob 条目仍为非阻断提案。

---

## 1. 背景与问题定义

V4.2 中，M07 的正式目标是 `Workspace Graph Projection v1`。当前真实对象聚焦于：

```text
Conversation / Message / Resource / Run / Relation
```

M07 保留的核心设计包括：

```text
ObjectRef
relation catalog
layout projection
incremental projector
bounded API
clean rebuild
archive / tombstone / retract / remove
```

与此同时，当前前端已经具备较好的核心边界：UI 通过 `api.ts` 与 Application / Server 交互，Domain / Runtime 没有被 React 直接穿透；颜色、字体、圆角、栏宽等基础视觉常量也已经集中在 `tokens.css`。

因此，“后续修改一次 UI”本身成本并不高。

但从连续多轮 UI redesign 的角度看，当前前端已经出现两个明显的迭代税来源：

1. `src/App.tsx` 同时承担 Workspace/application state、API orchestration、navigation、modal、keyboard、network、optimistic update、streaming、workspace switching 与页面 composition 等大量职责；
2. `app/static/css/app.css` 已增长为大型全局 stylesheet，而 `tokens.css` 仍然很小，说明视觉 token 已有基础，但 layout / surface / overlay 等样式边界尚未形成。

此外，`ChatView.tsx`、`GraphView.tsx` 等核心页面组件也已经达到“页面级组件”规模。当前这不是缺陷，但如果未来经历多轮如下调整：

```text
三栏 → 两栏
Context Panel → Drawer / Overlay
Chat + Graph → Split View
Activity → Bottom Panel
Sidebar → Collapsible Navigation
Graph / Context / Workflow 状态联动
跨页面 coordinated motion
```

那么前端修改成本可能逐轮增加，即：第一次改动便宜，后续开始需要同时触碰 App coordinator、多个页面组件和大量全局 CSS override。

M07 正好会改变 Graph 的数据与投影边界，因此是建立最低限度 UI seam 的低成本窗口。

---

## 2. Patch 决策

### 2.1 核心决策

在 M07 开发过程中增加一个 **伴随式、非阻断、严格限范围的 UI Seam Hardening Sidejob**。

它不独立成为 Milestone，不改变 M07 的产品目标，也不提前执行 M18 的 UI / 信息架构升级。

Sidejob 的判断标准是：

> 只有当修改能直接降低当前 M07 / Graph 前端变化的耦合，或明显降低未来 UI 重组成本时才做；不能证明当前价值的抽象全部延后。

### 2.2 与 M18 的职责边界

M07 Sidejob 负责：

```text
seam
boundary
extraction
style ownership
projection / presentation separation
```

M18 负责：

```text
新的信息架构
新的 Workspace 主布局
Graph UX v2
Context Tray / 新交互
视觉语言升级
复杂动效
响应式策略
Dock / Split / Resizable 等 Workspace interaction
```

因此：

```text
M07 = make UI replaceable
M18 = actually replace / redesign UI
```

---

## 3. 目标

Sidejob 完成后应达到以下状态。

### 3.1 UI Shell 与业务状态不再继续混合增长

当前 `App.tsx` 可以继续作为应用入口和最上层 coordinator，但不应继续同时承担越来越多具体布局实现。

目标结构不是强制目录规范，而是职责关系：

```text
App / AppRoot
│
├─ application / workspace orchestration
│   ├─ workspace loading / switching
│   ├─ API mutations
│   ├─ optimistic reconciliation
│   ├─ stream updates
│   └─ provider / runtime state
│
└─ presentation composition
    └─ AppShell
        ├─ Sidebar surface
        ├─ Main surface
        ├─ Context surface
        └─ Overlay layer
```

关键要求：

> “Context 里有什么”与“Context 显示在右栏、Drawer、Popover 还是底部”应逐渐成为两个不同的问题。

### 3.2 Graph Projection 与 Graph Presentation 明确分离

M07 会引入/强化 ObjectRef、Relation、layout projection、bounded API 等概念。

前端必须避免把 M07 的 projection storage / projector implementation 细节直接写进 `GraphView` 的 UI 行为。

推荐边界：

```text
Domain facts / Journal
        ↓
Graph Projector
        ↓
Graph Projection API / DTO
        ↓
UI-facing graph model
        ↓
GraphView presentation / interaction
```

Graph UI 可以消费 position、relation、visible neighborhood 等投影结果，但不能反向要求 Domain 为某个当前视觉布局产生 UI-only 语义。

### 3.3 CSS 从“单个大文件”演化为按 surface 所有权组织

目标不是建立完整 Design System，也不是全面切换 CSS Modules / CSS-in-JS。

只是把现有 CSS 逐渐形成可定位的所有权边界，例如：

```text
app/static/css/
├─ tokens.css
├─ base.css
├─ shell.css
├─ chat.css
├─ graph.css
├─ context.css
├─ overlays.css
└─ app.css        # 可作为兼容入口 / aggregator；是否保留由实现决定
```

文件名不是 Blocking Contract；真正需要满足的是：修改 Graph 样式时，不再需要在一个 70KB+ 全局文件中寻找和覆盖无关规则。

### 3.4 Token 体系只做“被现实需求证明”的扩展

当前已有：

```text
color
font
shadow
radius
sidebar width
context width
easing
```

M07 过程中如果真实出现跨 surface 重复使用的布局/层级/动效常量，可以提升为 token，例如：

```text
header height
surface gap
panel transition duration
shared overlay z-index
```

但禁止为了“以后也许有主题系统”提前建立庞大 token taxonomy。

---

## 4. Non-goals / 明确禁止项

本 Patch 不允许借 M07 名义实施以下工作：

```text
× Redux / Zustand / MobX 等全局状态库迁移
× 新 UI framework / component framework 迁移
× Framer Motion / Motion 等动效框架预装
× Tailwind / CSS-in-JS / CSS Modules 全量迁移
× 完整 Design System / Storybook 平台建设
× Dockable / Resizable Workspace
× Split View
× 新 Sidebar IA
× Context Drawer 产品重构
× Chat UI 全面重做
× Graph UX v2
× Mobile-first / 全响应式重构
× Dark Mode / 多主题系统（除非已有独立产品需求）
× 因 UI 重构修改 Domain 事实模型
× 因 UI 重构修改 M07 Graph Projection 的核心语义
× 为未来 Workflow / Multi-Agent UI 提前增加页面或状态机
```

若某个 sidejob 修改开始需要上述任一项，应立即停止并记录到 M18 或对应未来 Milestone。

---

## 5. 实施范围

### SJ-01 — Characterization First

在做结构移动前，先固定当前关键 UI 行为。

优先复用已有测试：

```text
src/App.test.tsx
src/components/GraphView.test.tsx
现有 e2e
M07 自身 projection / API tests
```

只为“即将被提取但当前缺少保护”的行为补最小 characterization test。

重点保护：

- Workspace 加载/切换后当前 view 行为；
- Chat / Graph / State / Runs / Activity 导航；
- Context Panel 开关；
- Settings / Command Palette / Onboarding overlay；
- Graph node activate / move / create / archive / restore；
- Graph edge create / delete；
- keyboard shortcuts 与关键 focus 行为；
- 网络恢复后的 Workspace refresh；
- M07 新 Graph Projection API 的前端消费。

原则：

> 先证明“行为没变”，再移动代码；不使用视觉重构掩盖结构重构。

---

### SJ-02 — Extract Presentation Shell

从 `App.tsx` 中提取纯 presentation composition seam。

推荐最小形式：

```text
App.tsx
  ↓
<AppShell ... />
```

`AppShell` 负责：

- Sidebar / Main / Context / Backdrop 的空间组合；
- 当前 view 对应哪个 surface；
- panel / overlay 的显示关系；
- layout class / aria landmark / skip-link 等 presentation concern。

`AppShell` 不负责：

```text
api.* 调用
Workspace persistence
Graph mutation
Context mutation
Provider persistence
streamMessage
retry / reconciliation
Domain command construction
```

建议约束：

```text
AppShell must not import ./api
AppShell must not import server/*
AppShell must not own domain persistence semantics
```

是否进一步抽 `OverlayLayer`、`WorkspaceSurface` 等组件，取决于提取过程中是否自然出现；不要为了目录漂亮继续拆分。

#### 完成判据

- 修改三栏/两栏的 DOM composition 时，主要修改点落在 shell 层；
- 业务 API handler 不需要因为 panel 改位置而迁移；
- `App.tsx` 仍可做 coordinator，但不继续承载所有 layout markup。

---

### SJ-03 — Keep Application Behavior Out of Layout State

对现有 state 做语义分类，但不要求迁移到新状态库。

可以在代码层明确区分：

```text
Application / Workspace State
- messages
- contextItems
- discussionNodes / edges
- manifests
- provider catalog
- workspace identity
- activity

UI / Layout State
- view
- contextOpen
- settingsOpen
- paletteOpen
- onboardingOpen
- focus request
```

目标不是一次性全部抽 Hook，而是确保后续新增的 UI-only state 不再与持久化业务 mutation 纠缠。

如果 M07 实施中自然需要整理，可提取小型 hook/controller；如果只是为了“架构更漂亮”，不做。

禁止将所有状态强行塞进单个 `useAppStore()`。

---

### SJ-04 — CSS Ownership Split

将 `app.css` 按现有 surface 逐步拆分。

建议顺序：

```text
1. base / global primitives
2. app shell / sidebar / workspace frame
3. graph
4. context panel
5. chat
6. overlays / dialogs
```

实施规则：

- 第一轮只迁移现有规则，尽量不改 selector 语义；
- 不趁拆文件重命名整套 class；
- 不做“顺便统一所有 spacing”的大规模视觉清理；
- 保持 cascade 顺序可预测；
- 共享规则只有确实跨 surface 使用时才进入 base/shared；
- 避免通过不断增加 specificity 解决拆分后的冲突。

如果使用 `app.css` 作为 aggregator，则必须保证 import order 明确；如果由 `main.tsx` 直接按序 import，也可接受。

#### 完成判据

- Graph 样式有明确所有权文件；
- Shell/Sidebar/Workspace frame 与 Graph 页面样式不再混在同一区段；
- Context/Overlay 等高频未来改动 surface 能独立定位；
- 无明显新增 specificity debt。

---

### SJ-05 — Token Hardening During Touch

只在修改到相关规则时处理硬编码。

适合提升为 token 的条件：

1. 至少跨两个 surface 重复；或
2. 明显属于产品级视觉/布局语义；或
3. 未来 M18 高概率需要整体调整，且抽取成本接近零。

不满足条件的局部值继续留在组件样式中。

推荐 token 分类保持很小：

```text
foundation
- color
- typography
- radius
- shadow

layout
- sidebar width
- context width
- shared header height（若真实重复）

motion
- existing easing
- shared duration（若真实重复）

layer
- overlay/panel z-index（若当前确有冲突）
```

不建立：

```text
semantic component token matrix
100/200/300 spacing scale
完整 elevation system
完整 animation choreography tokens
```

除非 M18 的实际设计证明需要。

---

### SJ-06 — Graph Projection / Presentation Contract Check

这是与 M07 主任务耦合最紧密的一项。

M07 新 Graph API / DTO 设计时增加以下检查：

#### A. Projection 可以重建，不依赖当前 React tree

```text
Journal / current facts
→ projector
→ projection
```

不能出现：

```text
React local state
→ 反向成为 Graph projection 的事实来源
```

#### B. UI-only 状态不进入 Domain Relation

例如：

```text
panel 是否打开
节点 hover
当前 zoom
临时 selection marquee
drawer docking
animation phase
```

这些属于 presentation state，不进入 Domain relation catalog。

如果 M07 明确需要持久化 viewport / layout preference，应放在 projection/layout preference 语义中，而不是伪装为 Domain fact。

#### C. GraphView 不绑定 projector 内部实现

前端依赖稳定 DTO / bounded API，而不是：

```text
projection table schema
projector cursor
journal sequence implementation
storage-specific field
```

#### D. 大图按需加载不会反向绑死 UI 结构

bounded/neighborhood API 应表达“需要哪些 graph data”，而不是表达“当前某个 sidebar widget 的数据结构”。

这样 M18 可以替换 Graph UX，而 M07 API 不需要跟着重写。

---

## 6. 推荐实施顺序

Sidejob 应与 M07 主线穿插，而不是先停掉 M07 做前端重构。

### Patch A — Baseline / Characterization

```text
M07 Graph contract 开始实现
↓
确认 App / GraphView 当前测试覆盖
↓
只补缺失的关键 characterization
```

输出：

- 无产品行为变化；
- 建立后续 extraction 的安全网。

### Patch B — Graph Contract + Presentation Boundary

在 M07 bounded API / DTO 落地时同步完成：

```text
projection internals
≠
UI-facing DTO
≠
GraphView presentation state
```

输出：

- GraphView 不知道 storage/projector internals；
- layout projection 与 UI-only interaction state 分开。

### Patch C — AppShell Extraction

当 M07 前端开始消费新 Graph projection 时，顺手抽出 shell composition。

输出：

```text
App coordinator
+
AppShell presentation seam
```

不继续扩张成完整 state architecture。

### Patch D — CSS Split / Token Touch-up

只拆当前 M07 / Shell 会修改到的 CSS，再补 Chat / Context / Overlay 的自然边界。

输出：

- surface ownership 清晰；
- 当前视觉尽量保持一致；
- 不启动 UI redesign。

### Patch E — Sidejob Closure

最后执行：

```text
M07 tests
UI characterization
lint / typecheck
build
existing e2e
manual smoke / design QA
```

记录所有刻意延期到 M18 的 UI 问题。

---

## 7. Acceptance Criteria

Sidejob 的 Acceptance 与 M07 Blocking Acceptance 分开。

M07 主目标不得因为 Sidejob 未完成而被错误判定失败；但如果 Sidejob 已开始合入，则必须满足以下质量条件。

### 7.1 Architecture Acceptance

- [ ] UI 仍只通过既有 API / Application 边界操作业务能力；
- [ ] 未新增 React → DB / storage / projector-internal 直接依赖；
- [ ] Graph projection 的事实来源不依赖 React local state；
- [ ] UI-only state 未进入 Domain relation catalog；
- [ ] GraphView 通过稳定 DTO / bounded API 消费 M07 projection；
- [ ] AppShell / presentation seam 不导入 `api.ts` 或 server implementation；
- [ ] 未因 sidejob 修改 M07 的 Domain 语义或 Journal truth model。

### 7.2 UI Maintainability Acceptance

- [ ] Shell layout 已有明确代码所有权，不再完全内嵌于 `App.tsx`；
- [ ] Graph 样式有独立所有权边界；
- [ ] Context / overlay 等未来高频变动 surface 可独立定位；
- [ ] 新增共享视觉常量优先复用/扩展 token，而非继续散落魔法值；
- [ ] 没有为了重构引入新的全局状态库、UI framework 或 motion framework；
- [ ] 没有建立未经需求验证的通用 Design System abstraction。

### 7.3 Behavior Preservation Acceptance

以下现有行为不得因 sidejob 回归：

- [ ] Chat / Graph / State / Runs / Activity 导航；
- [ ] Workspace 切换；
- [ ] Context Panel 开关与基本交互；
- [ ] Provider Settings；
- [ ] Command Palette；
- [ ] Onboarding；
- [ ] keyboard shortcuts；
- [ ] Graph activate / move / create / archive / restore；
- [ ] Graph relation create / delete；
- [ ] 网络恢复/刷新；
- [ ] Chat streaming 与 optimistic pending message 行为；
- [ ] M07 新 Graph Projection 功能。

### 7.4 Regression Gate

至少运行：

```text
pnpm run lint
pnpm run typecheck
相关 unit tests
src/App.test.tsx
src/components/GraphView.test.tsx
M07 projection / API tests
现有 e2e
pnpm run build
```

若项目届时已有 M07 专属 gate，则以 M07 gate 为主，并将 sidejob tests 纳入该 gate 或 CI 常规测试集。

---

## 8. Stop Conditions

出现以下任一情况，停止 Sidejob，剩余工作移交 M18：

```text
1. 需要修改 Domain schema 才能完成 UI seam；
2. 需要修改 Graph relation 语义来迁就当前视觉结构；
3. 需要引入新的全局状态框架；
4. 需要进行大规模 class rename / component rewrite；
5. 开始讨论最终 Sidebar / Context / Workspace IA；
6. 开始实现 Dock / Split / Resize / Complex Motion；
7. Sidejob 与 M07 projection 主线产生明显 merge / review 干扰；
8. 为了“未来可能需要”产生多层抽象却没有当前调用方；
9. 需要同时修改大量 Chat 行为才能继续；
10. 无法通过 characterization 保证行为等价。
```

处理原则：

> **M07 主任务优先。UI seam 能低成本得到就拿；开始变成独立工程就停止。**

---

## 9. 风险与控制

### 风险 A — 借重构偷偷做 UI redesign

最容易发生，因为拆 CSS / Shell 时会自然看到大量“顺手可以优化”的东西。

控制：

```text
behavior preserving first
visual redesign deferred to M18
```

除非当前 UI bug 阻断 M07，否则不改变产品设计。

### 风险 B — 为了降低耦合引入更多抽象

典型错误：

```text
AppShell
→ LayoutManager
→ SurfaceRegistry
→ PanelController
→ WorkspacePresentationRuntime
```

这些都没有当前需求。

控制：

> 一次 extraction 后如果职责已经足够清晰，立即停止。

### 风险 C — CSS 拆分导致 cascade regression

控制：

- 保持原加载顺序；
- 第一轮尽量不改 selector；
- 拆分与视觉调整分开提交；
- 关键 surface 做 smoke / screenshot 对比。

### 风险 D — M07 Projection DTO 被当前 GraphView 绑死

控制：

API/DTO 描述 Graph 数据需求，不描述某个具体 UI widget；projection storage schema 不直接暴露到组件。

### 风险 E — AppShell 变成新的 God Component

控制：

AppShell 只做 presentation composition；业务 mutation 留在 coordinator/application side。未来若 Shell 自身继续膨胀，等真实 M18 需求出现再进一步拆。

---

## 10. 建议的 PR 边界

如果开发节奏允许，优先保持小 PR：

```text
PR-1  M07 graph projection contract / API
PR-2  Graph frontend adaptation + projection/presentation boundary
PR-3  AppShell extraction + characterization
PR-4  CSS ownership split + minimal token hardening
```

也可以按实际开发合并 PR-2/PR-3；关键是不要把以下内容混在一个不可审查 diff 中：

```text
Graph semantics change
+
large UI redesign
+
CSS rewrite
+
state management migration
```

Sidejob PR 的 review 问题应始终是：

> 这次修改是否减少了未来 UI 变化需要触碰的无关区域，同时保持现有行为与 M07 语义不变？

---

## 11. M18 Handoff

M07 Sidejob 结束时增加一份很小的 deferred list，供 M18 使用。

建议只记录已观察到的问题，不提前设计解决方案：

```text
Observed UI limitation
Evidence / affected workflow
Current seam available?
Why deferred
```

例如：

```text
Context 右栏在 Graph 高密度场景占用空间较大
→ M07 dogfood 观察
→ ContextSurface 已可独立重排
→ M18 再决定 Drawer / Tray / Bottom Panel
```

禁止在 M07 handoff 中提前确定：

```text
“未来一定使用 Drawer”
“未来一定上 Framer Motion”
“未来一定采用 IDE layout”
```

M18 应根据 M12–M17 的真实使用数据重新决定信息架构。

---

## 12. Definition of Done

这个 Sidejob 的成功不是代码被“抽象得更漂亮”，而是同时满足：

```text
M07 Graph Projection 正常完成
+
当前 UI 行为基本不变
+
未来布局变化主要落在 presentation seam
+
Graph projection 不绑定当前 GraphView
+
CSS 修改具备 surface ownership
+
没有新增未经验证的平台级前端复杂度
```

最终理想状态：

```text
Today

Domain / Journal
      ↓
Application / API
      ↓
Projection DTO
      ↓
App coordinator
      ↓
AppShell / Feature Surface
      ↓
Presentation + CSS


M18 redesign

Domain / Journal         unchanged
Application / API        mostly unchanged
Projection DTO           mostly unchanged
App coordinator          minimally affected
AppShell / surfaces      freely reorganized
Presentation / CSS       intentionally replaced
```

这就是本 Patch 唯一需要争取的长期收益。

---

## 13. 一句话工程原则

> **M07 不设计 RHIZA 的最终界面；M07 只确保 M18 有权低成本重新设计它。**
