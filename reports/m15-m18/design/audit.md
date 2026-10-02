# Rhiza UI/UX audit and preview verification

Date: 2026-10-02. Scope: the existing Rhiza workspace UI and the user-requested compact redesign. Current-state fixtures are isolated from real workspace data; no model key or paid call is used.

## Current evidence and priorities

Fresh CUA captures: `before-desktop.png` (1440×900 Chat), `before-graph.png` (1440×900 Graph), `before-narrow.png` (390×844 Chat). Source grounding: AppShell, Sidebar, ChatView, ContextPanel composition, shell/chat CSS, tokens, architecture and know-how UI constraints.

| Priority | Evidence | User cost | Proposed response |
| --- | --- | --- | --- |
| High | Chat repeats discussion title in header and large introduction, followed by a management row | The actual conversation starts substantially lower | One title bar; metadata and management in object menu |
| High | Fixed 238px Sidebar and 328px Context; Graph also has stacked filters and an empty archived section around its canvas | Canvas and reading space are constrained regardless of task | Both rails can collapse; Graph is full width, filters/archives become explicit secondary entries |
| High | Numerous metadata/action styles use 7–11px text; each Context source repeats role, token, reason and multiple actions | Visual noise and poor scanability despite unused space | Primary body 14–15px, compact source rows, progressive actions and consistent labels |
| Medium | Multiple main Graph/history/management buttons compete in Chat header and messages | More scanning before the primary task | Named navigation plus source/Replay row and an overflow menu |
| High on narrow | 390px capture loses Workspace identity and uses mostly unlabeled bottom icons | Users lose location and must learn icon meanings | Persistent Workspace/object title, four labeled destinations, full navigation in Workspace sheet |

The redesign keeps the existing palette and evidence-first semantics. Density is improved by removing duplicate framing and letting task content use available space, not by shrinking readable content further.

## Mature references used

- [VS Code custom layout](https://code.visualstudio.com/docs/configure/custom-layout): explicit primary/secondary sidebar visibility and title-bar layout controls. Applied to predictable collapse controls; not importing its IDE domain model or source.
- [Linear personalized sidebar](https://linear.app/changelog/2024-12-18-personalized-sidebar): sidebar grouping and task-relevant navigation. Applied to separation of frequent destinations from data/settings utilities; existing Rhiza destinations remain accessible.

No third-party source or remote asset was incorporated; no package was added. The preview uses project palette values and small original SVG primitives. Production will reuse the existing Lucide/ParticleMark components and locally bundled typography.

## Bounded preview QA

One desktop/narrow pass and one targeted confirmation after fixes. This verifies the prototype, not production backend integrations or formal accessibility compliance.

- `node --check reports/m15-m18/design/preview.js`: passed.
- `git diff --check`: passed at preparation; repeated only after final documentation changes.
- Service identity checked before browser navigation: exact Rhiza preview title, CSS and JS HTTP 200.
- Desktop 1440×900: no document horizontal overflow. Open rail is 304px; center is 916px. Collapse expands center to 1220px and returns focus to the opener.
- Assisted recommendation confirmation: selected count, header count, composer count and budget agree (2 → 3, 4.2K → 5.4K). Historical source count stays 2, as it belongs to the old answer.
- Graph: Context hidden by default, full canvas, explicit selection tray. Adding selection only opens a preflight explanation; it does not silently add sources.
- Collaboration: mock loading → A complete / B connection failure → B-only retry → synthesis with disagreement. Real execution remains separately verified in backend tests.
- Provider: search empty state, error with manual models retained, failed-item retry success all visibly verified.
- Narrow 390×844: Workspace/object title, labeled navigation and composer remain visible. No document horizontal overflow. Context sheet is 390px wide, closes with Escape and returns focus to `context-toggle`.
- Narrow navigation reaches Data/backup; excluding files changes export preflight copy. Dialog fits within 358px and missing-file import is presented as non-activatable.
- Browser error log at the end of the first pass: empty.
- Corrections from review: retain a collaboration input snapshot independent of subsequent selection changes; keep Graph zoom/fit reachable on narrow screens. Targeted confirmation passed: switching current Context Auto → Strict reduced current count 3 → 2 while frozen collaboration retained all 3 original sources; narrow Graph exposes zoom/fit and selected-object actions without document overflow.

Screenshots: `desktop-preview.png`, `graph-preview.png`, `collaboration-preview.png`, `narrow-preview.png`, `context-narrow-preview.png`. Only fresh screenshots inspected from actual browser bytes are accepted as visual evidence.

### Inline collaboration correction

The user clarified that collaboration belongs to the current conversation. The earlier standalone collaboration screen and navigation destination are superseded. The preview now starts from an answer or composer, accepts 2–4 model choices and all four existing modes, freezes the input, shows individual failures/retry and Stop, and retains synthesis plus disagreements or missing-participant facts in that same discussion. Continuing Chat displays a sample answer referencing the retained result. The configuration collapses into a compact frozen-input summary during execution, and the completed card can be collapsed without losing access to its evidence.

Desktop and 390×844 browser passes verified initiation, partial failure, individual retry, retention and continuation. Narrow page width equals the viewport (390px); composer ends at the navigation boundary, without overlap. Three focused prototype regression cases verified scope/navigation, frozen selection, retry isolation, deduplicated retention, Stop and partial-result labeling. JSDOM lacks native dialog methods; the test harness supplies those methods, with real modal behavior checked in the browser. `node --check` and `git diff --check` passed. No model/API calls or persisted mutations occur in this standalone prototype.

Current evidence: `inline-collaboration-desktop.jpg`, `inline-collaboration-continuation.jpg`, `inline-collaboration-narrow.jpg`. Production React wiring and the concrete preview approval remain pending.

Project verification commands are defined in package.json (`pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, `pnpm run test`). They are reserved for the production React implementation; no production files changed in this preview step, so the full backend suite was not rerun.

## Remaining boundary

Approval of the concrete preview is pending under ui-ux-design-suite. Production implementation, full shared-consumer regression, desktop/narrow real import/source/Replay/Purge checks and external acceptance remain separate work. The prototype and simulated states must not be reported as those features having passed production acceptance.

### Approved production unit: conversation, Context and Replay

The user explicitly approved the concrete preview on 2026-10-02. The production React workbench now uses a 220px collapsible navigation column, one 56px title bar, an optional 304px Context rail, and four named narrow-screen destinations. At 1200px Context becomes a modal drawer; at 760px it becomes a bottom sheet. The composer occupies its own flex row. Discussion management remains available through disclosure.

Context preview, version-bound accept/reject with user reasons, frozen Manifest history and provenance navigation use the scoped existing HTTP interfaces. Replay first checks frozen resources and available policies; listed differences require explicit acceptance. Missing resources disable all execution choices. Historical message counts come only from that message's Manifest.

The affected UI run verified 48 cases initially; the two failures (safe error wording and an empty-workspace fallback title) were fixed and both affected cases passed. Additional shell/provenance checks passed. Typecheck and lint passed after the final changes. The prepared real HTTP/PGlite client regression passed in the preceding implementation step. A desktop browser pass on the actual React UI completed selection → Chat → provenance → frozen history → Exact Replay with an isolated encrypted PGlite store and an explicitly offline model. A 390×844 pass verified the Context bottom sheet, focus isolation and Escape recovery. Document width was 390px; composer bottom and navigation top were both 784px.

Evidence: `product-context-desktop.jpg`, `product-chat-narrow.jpg`, `product-context-narrow.jpg`. This unit does not complete collaboration, data migration, graph delivery or any external milestone Gate.
