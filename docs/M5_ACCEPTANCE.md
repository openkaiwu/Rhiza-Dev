# M5 Acceptance — Context Planner MVP + Files

> **Historical Evidence Only(2026-08-22)**:本文件是 Legacy 里程碑验收证据,其编号不定义当前 Milestone。当前基线见 `docs/Rhiza_开发路线图_V4.1_20260824.md`(统一 M01+ 编号)。

## 结论

M5 已完成。聊天前由确定性的本地 Context Planner 统一生成上下文投影：Node、Segment 与 File chunk 进入同一 Candidate 集，融合词法命中、离线语义向量和图距离排序；显式 Context 先占预算，自动结果只能使用剩余预算。每个自动来源的选择原因、得分相关信号和 Planner 指标都会冻结进 Context Manifest。

## 验收映射

- [x] Node / Segment / File 均可进入 Candidate：节点、片段和带字符区间 provenance 的文件 chunk 使用同一候选结构。
- [x] Hybrid retrieval 有可重复测试集：确定性 tokenizer、feature-hash embedding、稳定 tie-break，并验证重复查询结果一致。
- [x] 用户显式 Context 的优先级高于自动检索：显式 Active / Pin 先保留；自动项只使用剩余 token budget。
- [x] 自动检索结果显示 `why selected`：Manifest UI 显示词法命中、语义相似、图邻近或显式附件原因。
- [x] 10 / 100 / 300 Node Project 有基准测试：每种规模执行 20 次并取本地 P95。
- [x] 100 Node Project 的 Planner 本地处理 P95 < 2 秒：自动测试以 2,000ms 为硬门禁。
- [x] 10MB 级文本/PDF 资源不会作为整段 `extractedText` 常驻：长资源拆成最大约 4,000 字符的索引块；仅小文本保留兼容投影，API 从不返回提取正文。
- [x] 长资源通过 chunk / summary 投影进入 Context：文件保存缓存摘要，单次请求最多投影每个显式附件 4 个相关块。
- [x] Planner 错误或无结果时降级：异常时保留显式 Active 与 Current Node，不阻断 Runtime 调用，并在 Manifest 标记 `fallback`。

## 自动化证据

- Planner 单元测试覆盖 chunk provenance、混合排序可重复性、显式优先、token budget。
- 10 / 100 / 300 Node benchmark 覆盖 P95 目标。
- 本机 50 次实测 P95：10 Node `0.20ms`、100 Node `1.24ms`、300 Node `2.89ms`。
- API 测试验证文件索引、显式附件 chunk 投影、`why selected` 与 Planner diagnostics。
- 既有 M0–M4 单元、集成、PostgreSQL E2E、license 与 production build 门禁全部继承。

## 执行命令

```bash
npm run verify:m5
npm run benchmark:m5
```
