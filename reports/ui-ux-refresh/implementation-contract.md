# Rhiza UI/UX refinement

The user requests a modern, simple, attractive and space-efficient product UI, using the already approved compact workbench at http://127.0.0.1:4175/preview.html as a reference rather than a pixel clone. The existing preview contract records explicit approval. This pass keeps that flow and visual direction.

## Current evidence and scope

Live application: http://127.0.0.1:4173, served by .. The chat's ff9d checkout predates these features; it is not the implementation target. Existing uncommitted application/resource work is preserved.

- P1: three stacked navigation/header bands reduce the reading area. Use a single shell title bar and disclose location/management actions.
- P1: workspace management and repeated path metadata dominate the sidebar. Disclose workspace management; retain navigation, switching and recovery.
- P1: messages have small typography, heavy frames and repeated action rows. Use readable content, lighter messages, primary provenance/collaboration actions and an accessible secondary disclosure.
- P1: collaboration uses full-width stacked participants and exposes technical input metadata before the result. Use two participant columns when space permits, explicit status badges, concise progress, separate synthesis and optional frozen evidence.
- P2: context, settings, knowledge and history use inconsistent small text. Reuse semantic palette and establish readable text/control density across these surfaces.
- User steering explicitly adds execution history and the activity timeline: searchable loaded records, clear states/recovery, date groups, optional complete identities, and distinct loading/error/filter-empty states. Exact Run targets remain accessible under filtering; activity retains journal order. These are presentation/client-filter changes with no new server query or persistence contract.

## Impact and acceptance

| Target | Propagation | Preserved behavior | Checks |
| --- | --- | --- | --- |
| AppShell + Sidebar | All views; compact header, workspace disclosure, named navigation | Workspace scope, object routes, mobile navigation, modal focus | Components, navigation regression, desktop/narrow browser |
| ChatView | Chat only; reading and action hierarchy, composer tools | Streaming, IME, retry/stop, edits, attachments, branches, provenance | App tests, keyboard disclosure, browser |
| CollaborationCard | Inline setup/results only | Model limits, immutable common input, participant retry, Stop, synthesis, retention | Existing/new collaboration tests, browser real retained state |
| RunHistory + ActivityView | Compact rows, client search/filter, activity date groups | Scoped exact Run, polling, immutable events, retry identity, Stop/replay/preflight/source inspection | Loading/filter/focus/order regression, existing recovery tests, desktop/mobile browser |
| workbench.css | Existing shared presentation; reuse tokens and Lucide | Graph model, context decisions, history/data/provider contracts | Frontend suite, lint, typecheck, build, representative screens |

No new dependency or parallel theme. No server, authentication, migration, persisted data or model protocol changes. Native disclosure elements are sufficient for these action lists; Escape/outside close and focus return are verified. Narrow layouts keep a useful reading width, 16px inputs and reachable navigation. Existing archived/offline/partial/loading/error states stay visible. Visual inspection does not establish full accessibility compliance.

Verification commands are derived from package.json: pnpm run lint, pnpm run typecheck, pnpm run test:unit, pnpm run test:e2e, pnpm run build. Targeted frontend verification uses pnpm exec vitest run src --maxWorkers=1 --testTimeout=30000. QA is one inspect/fix pass and one confirmation pass, with extra work only for concrete failures.
