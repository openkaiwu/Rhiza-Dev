# Collaboration reuse assessment

Reviewed primary repositories and licenses on 2026-10-02:

- [OpenAI Agents SDK](https://github.com/openai/openai-agents-js): provider-agnostic agents, handoffs, sessions and tracing; [MIT license](https://github.com/openai/openai-agents-js/blob/main/LICENSE).
- [LangGraph.js](https://github.com/langchain-ai/langgraphjs): graph execution/resilient agent framework; [MIT license](https://github.com/langchain-ai/langgraphjs/blob/main/LICENSE).

Architectural decision: reuse RHIZA's existing RuntimePort/ProviderRuntime, immutable ExecutionRun/ContextManifest, encrypted content, Application/UoW and cancellation/recovery. Adopting a second execution/session/persistence engine for M16 would create a competing authoritative lifecycle and prematurely introduce Workflow semantics. These projects are evaluated references; no third-party code is copied and no package is added. If the project later needs a generic Workflow engine, reassess at that milestone.

The bounded collaboration policy is Application-owned. It carries group/participant identity, a frozen Context base, per-attempt Run/Manifest/endpoint references, previous-round exchange, reserved synthesis and participant cost, Stop, interrupted recovery and original-input Retry. Production dispatch commits reservation with Run creation through UoW before Runtime. Successful terminal/Message/Manifest/collaboration facts commit together. Separate output branches preserve ordinary Chat input. Facts reuse encrypted append-only Journal publication rather than adding a second encryption or persistence engine. The PGlite integration tests cover HTTP, restart, Stop, half-commit, Bundle and Purge; full product orchestration and milestone acceptance remain pending.
