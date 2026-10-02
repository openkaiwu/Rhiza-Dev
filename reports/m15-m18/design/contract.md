# Rhiza compact workbench — preview contract

Status: concrete preview ready for approval; production UI implementation has not started. This supersedes the earlier card-based preview in this directory. The current user request prioritizes layout, space efficiency, simplicity and product quality before the remaining M15–M18 work.

## Evidence and direction

Current application was verified at `http://127.0.0.1:4173/` (Rhiza title, Vite entry and isolated fixture API). Fresh desktop, narrow and Graph captures are in this directory. See `audit.md` for findings and references. The product-design audit specialist owns diagnosis; ui-ux-design-suite internal prototype/impact playbooks own the visual proposal. No production component, token, API or persisted data changed.

- 220px collapsible sidebar: workspace switch, search, named navigation, discussion tree, settings/data utilities. Keep Chat, Graph, Knowledge, Runs and Activity available; add Collaboration within the same shell.
- One 56px desktop title bar. Chat drops its duplicate large discussion introduction. Discussion metadata and management stay available in the object menu.
- 304px optional Context rail; collapse releases the whole column. At widths below 1200px use a modal drawer; at 760px and below use a bottom sheet. This moves the current 1120px drawer threshold earlier to preserve a useful reading width.
- Chat uses a bounded reading column (790px normally), lightweight messages, inline source chips and progressive action disclosure. Composer remains visible in its own flex row; content scrolls independently.
- Graph gets the full workspace width by default. Compact search/filter toolbar, canvas controls and an explicit selected-object tray replace permanent surrounding cards. Selection and display filters never implicitly change Context.
- Narrow screens keep both Workspace and current object names. Four named navigation items: Chat, Graph, Collaboration, Workspace. Workspace opens the complete navigation tree.
- Reuse warm neutral/green semantic palette, restrained borders, small radii and project icon language. No new dependency or separate production design system. Proposed text scale: body 14–15px, primary controls 12–13px, secondary metadata 10–11px; narrow input is 16px to avoid focus zoom.

## Shared impact and propagation

| Change | Target / consumers | Intended propagation | Required production checks |
| --- | --- | --- | --- |
| Collapsible navigation + responsive shell | AppShell, Sidebar; all views | Systemic composition change; API/mutations stay in App coordinator | Workspace scope changes, stale-response guard, keyboard navigation, modal focus |
| One title/header layer | ChatView and workspace headers | Systemic shell; discussion details move into explicit menu | Existing management, history, quick/full Graph reachability, archives |
| Context rail/sheet and compact rows | ContextPanel, Chat, Graph Tray | Shared surface; selection counts remain coordinator-derived | Auto/Assisted/Strict semantics, version conflict, budget, confirmed/rejected/excluded, historical read-only view |
| Message presentation + composer | ChatView, MarkdownContent consumers | Local composition; reuse Markdown and existing actions | Streaming, Stop/retry, attachment chips, branch/edit/regenerate, provenance/Replay, long code/math |
| Full-size Graph canvas | GraphView and graph CSS | Local visual arrangement, existing graph-model boundary retained | Pan/zoom, list/keyboard selection, filters, relation editing, archive/undo, Context confirmation |
| Model/data list layouts | Provider settings and Bundle/backup controls | Local surfaces in common shell | Provider error/retry; import/export preflight and disabled activation; recovery target and scope |

## Preserved contracts

- Context confirmed/recommended/excluded remain distinct; Assisted recommendations require confirmation, Strict never adds recommendations, Auto labels automatic choices. Counts and budget derive from the same selection state.
- Historical Message/Run/Manifest/ResourceVersion identity, immutable version and provenance links remain intact. Missing/corrupt Replay resources block calls in all three policies.
- Collaboration freezes common inputs; retry uses original participant inputs, Stop prevents new dispatch and synthesis retains disagreement. Retain creates a referenced new message.
- Workspace and object identity remain visible. Global Provider settings do not silently change Workspace selection. Graph layout/filter changes are personal UI state, not domain relations.
- Bundle v1 and existing HTTP/scope/owner checks remain compatible. The preview demonstrates the proposed optional-file and backup flows; it does not establish backend completion for them.
- Purge remains guarded and irreversible. No new data deletion, migration, credential change or persistence contract is authorized by this visual preview.

## Preview fidelity and acceptance boundary

`preview.html`, `preview.css`, `preview.js` are standalone mock UI. Demonstrated interactions: collapse/expand, sheets and Escape focus return, navigation, search, Context decision/modes, Graph selection/zoom, source/Replay/missing-resource dialogs, participant partial-failure/retry/Stop, Provider empty/error/retry, export inclusion/preflight and import-disabled state. File upload, real model execution, backup/export creation, archive/Purge and persisted mutations are explanatory previews only.

After approval, implement incrementally in existing React components. Required production states also include long content, streaming, stale version, over-budget, offline, archived/unauthorized and loading. Mock screens do not prove these production paths or formal M15–M18 Gates.

The invoked skill requires: “Obtain user approval before touching production UI.” Approval remains pending for this concrete compact layout. No prior generic “start” message is treated as approval of this new preview.
