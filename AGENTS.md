# AGENTS.md

## Project Facts

- Architecture & boundaries: `docs/architecture.md`
- Durable project knowledge: `docs/know-how.md`
- Build: `<command>`
- Test: `<command>`
- Targeted test: `<command>`
- Lint / typecheck: `<command>`

If a command above is unset, derive it from project configuration and report
which command was used. Never invent one; if it cannot be determined, say so.

Nested `AGENTS.md` files specialize rules for their subtree. They may override
local conventions, but must not weaken root-level Verification, scope-control,
or High-Risk rules.

## Working Principles

- Before editing, inspect the affected implementation. For non-trivial or
  cross-boundary changes, read the relevant architecture and project knowledge.
  Verify material repository facts rather than guessing; state unresolved
  uncertainty. Do not load unrelated documentation mechanically.

- After context compaction, external/tool-generated changes, or whenever file
  state may be stale, re-read the affected file before editing it.

- Choose the simplest implementation that fully meets current requirements and
  preserves real architectural boundaries. Avoid speculative abstractions,
  configuration, indirection, and hypothetical extensibility.

- Keep changes scoped and incremental. Avoid unrelated refactoring and preserve
  existing behavior unless the requested change requires otherwise.

- Prefer existing project capabilities, patterns, components, and dependencies
  before introducing new implementations, abstractions, or packages.

- Before building substantial functionality from scratch, evaluate mature,
  actively maintained open-source implementations for reuse, wrapping, or
  reference. Consider maintenance, security, architectural fit, license
  compatibility, and dependency lifecycle cost.

- Match reuse to license obligations. Reuse, fork, vendor, or derive from
  third-party code only when its license is verified and compatible with the
  project's intended use. If compatibility is restrictive, unclear, or
  commercially material, use it only as a lawful reference and report the risk
  before incorporation. A public repository is not automatically reusable.

- Do not add compatibility layers, fallbacks, or abstractions for hypothetical
  needs. Add or preserve them when required by real external contracts,
  persisted data, integration boundaries, supported consumers, or documented
  architectural requirements.

- Do not remove or bypass an adapter, compatibility layer, abstraction, or
  architectural boundary until its callers, dynamic references, and purpose
  have been verified. Code with no supported consumer or documented role may
  be removed; layers isolating real variability, external systems, or
  compatibility requirements are architectural boundaries, not excess code.

- If a patch would duplicate logic, bypass a real boundary, or deepen known
  structural debt, prefer refactoring over stacking another workaround.
  Refactoring stays in scope only within the directly affected module or
  execution path and without unrelated public-contract changes.

- If completing the task requires broader scope, or changing a boundary, public
  contract, persisted format, or unrelated subsystem not implied by the request,
  report the conflict before proceeding. Do not silently widen scope or route
  around the boundary.

## Verification

- Verify changes with existing project tooling, proportional to blast radius:
  targeted checks for local changes and broader regression checks for shared
  code, contracts, or high-impact changes.

- When behavior changes or a bug is fixed, add or update regression tests unless
  the project has no suitable test infrastructure for that layer. If omitted,
  state why.

- Do not silently make checks pass by weakening them. Do not disable, skip,
  loosen, or rewrite existing tests unless the requested behavior intentionally
  changes their expectation. Any unavoidable type/lint suppression must be
  narrow and explicitly reported.

- A task is complete only when the requested behavior is implemented and required
  verification passes. If verification fails or is blocked, state exactly what
  was verified and what remains unverified.

## Project Knowledge

- Update `docs/architecture.md` for meaningful architectural changes, not
  ordinary implementation details.

- Record durable, non-obvious constraints, decisions, proven solutions, and
  recurring pitfalls in `docs/know-how.md`; no task history, obvious facts, or
  unnecessary additional knowledge files.

- Prefer executable enforcement when it naturally fits work already in scope.
  Encode relevant invariants in tests, types, or schemas where appropriate;
  propose rather than incidentally modify lint rules, hooks, CI, or unrelated
  enforcement infrastructure.

## Code Quality

- Match the project's established code and architectural conventions.

- Add logging, comments, or documentation only when they capture useful
  diagnostics or non-obvious constraints, reasons, or trade-offs.

## High-Risk Changes

- Secrets, authentication/authorization, persisted user data, migrations,
  destructive operations, external integrations, and license-sensitive
  third-party code are high-risk. Touch them only when the task requires it,
  preserve existing safeguards and obligations, and report what changed and why.