# M08 Context explanation visual acceptance

Date: 2026-09-06. Visual model review: **PASS**.

The assistant directly inspected the archived screenshots. The fixture renders the production App, ChatView and ContextPanel with deterministic API responses from `src/test/context-history-fixture.ts`. It covers selected and excluded sources, explicit selections exceeding the budget, priority order, current/manual selection modes, historical Manifest v1, full ResourceVersion/digest text and a missing Resource.

Reproduce with `pnpm exec vite --host 127.0.0.1 --port 4190`, then open `/scripts/fixtures/m08-context.html`. Dismiss onboarding if present and select either message's “查看本轮上下文”. Add `?narrow` to set the ContextPanel to 270px within the same desktop shell. This is a panel-width test, not a mobile viewport claim.

| Evidence | Reviewed result |
| --- | --- |
| [Desktop, 1280 × 720](context-desktop.png) | Historical title and return control are distinct from current-context editing. Budget overflow, selection order and missing-source warning are visible. |
| [270px panel, version expanded](context-narrow-version.png) | Full version ID and SHA-256 wrap inside the panel. Labels and selection reasons remain readable; expanded details scroll independently. |
| [270px panel, omissions](context-narrow-omissions.png) | Missing evidence is distinct from deliberate exclusion. User exclusion and Strict-mode omission explain why content was not used. No overlapping controls or clipped horizontal text. |

The App regression covers loading, return-to-current cancellation and discarding late historical responses after Workspace changes. Planner regression checks the actual excluded/strict/low-score/budget/chunk-limit decisions. Historical source integrity is covered separately by the SQL/Blob integration tests. These screenshots establish the product visual requirement; the final M08 gate still requires its full executable and commit-bound evidence.
