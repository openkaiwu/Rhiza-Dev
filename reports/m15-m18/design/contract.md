# M15–M18 preview contract

Primary authority: ui-ux-design-suite internal prototype/impact playbooks. Existing warm neutral/green tokens and hierarchy are preserved. Separate static prototype; no production component edits yet. Current-flow diagnosis is grounded in implementation and prior screenshots; live regression capture follows implementation.

- Context: confirmed/recommended/excluded remain separate. Preview includes exact version, reason, budget, confirmation/rejection and Replay policy differences. Preview itself has no model or persistent side effects.
- Collaboration: same frozen Context, selected models, bounded rounds/tokens/time, participant status/retry, durable stop, typed synthesis/disagreement and explicit retain action.
- Graph: display filters, keyboard-accessible multiselect, batch outcome/undo, Context Tray; personal position and display state. No graph edit becomes Context without explicit selection.
- Data: Provider catalog vs Chat health; backup status/location/time, restore preflight, Bundle file inclusion and credential mapping. No credentials in exports.
- Narrow layout: persistent Workspace/object title, named bottom navigation, Context sheet; desktop right panel is user-collapsible.

Shared impact: AppShell/Sidebar/header composition changes are systemic across Chat/Graph/State/Collaboration; preserve existing command/dialog surfaces, focus order and Workspace scope. ContextPanel changes affect Chat and Graph Tray; active count derives from coordinator state. Provider/backup are local surfaces. Existing tokens/primitives do not change globally.

States: loading, empty, partial failure, retry, stopped, source-version conflict, over-budget, offline, missing resource, archived/unauthorized; keyboard focus returns to opener on sheets/dialogs. One normal desktop 1440x900 and narrow 390x844 QA pass, at most one confirmation unless a concrete blocker remains.

Approval pending: concrete interaction/layout direction of preview.html. Backend implementation can continue; production UI waits for this explicit skill gate.
