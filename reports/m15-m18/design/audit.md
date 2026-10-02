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

Preview evidence: `inline-collaboration-desktop.jpg`, `inline-collaboration-continuation.jpg`, `inline-collaboration-narrow.jpg`. The user subsequently approved this concrete preview; production evidence is recorded below.

Project verification commands are defined in package.json (`pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, `pnpm run test`). They are reserved for the production React implementation; no production files changed in this preview step, so the full backend suite was not rerun.

## Remaining boundary

The concrete preview is approved under ui-ux-design-suite. Full shared-consumer regression, real import/Purge checks and external acceptance remain separate work. Prototype states do not substitute for production acceptance.

### Approved production unit: conversation, Context and Replay

The user explicitly approved the concrete preview on 2026-10-02. The production React workbench now uses a 220px collapsible navigation column, one 56px title bar, an optional 304px Context rail, and four named narrow-screen destinations. At 1200px Context becomes a modal drawer; at 760px it becomes a bottom sheet. The composer occupies its own flex row. Discussion management remains available through disclosure.

Context preview, version-bound accept/reject with user reasons, frozen Manifest history and provenance navigation use the scoped existing HTTP interfaces. Replay first checks frozen resources and available policies; listed differences require explicit acceptance. Missing resources disable all execution choices. Historical message counts come only from that message's Manifest.

The affected UI run verified 48 cases initially; the two failures (safe error wording and an empty-workspace fallback title) were fixed and both affected cases passed. Additional shell/provenance checks passed. Typecheck and lint passed after the final changes. The prepared real HTTP/PGlite client regression passed in the preceding implementation step. A desktop browser pass on the actual React UI completed selection → Chat → provenance → frozen history → Exact Replay with an isolated encrypted PGlite store and an explicitly offline model. A 390×844 pass verified the Context bottom sheet, focus isolation and Escape recovery. Document width was 390px; composer bottom and navigation top were both 784px.

Evidence: `product-context-desktop.jpg`, `product-chat-narrow.jpg`, `product-context-narrow.jpg`. This unit does not complete collaboration, data migration, graph delivery or any external milestone Gate.

### Approved production unit: inline collaboration and model settings

The actual React conversation now launches independent review, peer review, debate or second opinion with 2–4 configured models. Frozen setup collapses into a card at the initiating turn; participant output/status, individual Retry, durable Stop, Run/Manifest links, synthesis, alternatives, risks and missing evidence are exposed there. Retaining the latest synthesis creates a referenced message in the same discussion; ordinary Chat continues from it. Endpoint directory health, model search/favorite/pin filters, explicit catalog batch refresh and failed-only retry reuse existing global Provider contracts. Keys remain write-only.

A real scoped HTTP/encrypted PGlite/offline Runtime regression verified partial failure → only failed-model Retry → new synthesis → idempotent retention → follow-up history. Stable create/run/retry keys did not repeat external calls; unchanged synthesis evidence was rejected before invocation; original synthesis history stayed unchanged. Four existing collaboration lifecycle/recovery/stream cases passed once after the policy change. Two new App regressions passed for frozen-form collapse and a late Create after Workspace switch causing no stream dispatch. API/Card/Provider regressions passed with targeted fixes for explicit accessible names. Final typecheck and affected lint passed.

The actual React browser completed partial Retry, resynthesis, retention and continuation in the initiating conversation. Desktop and 390×844 layouts were inspected; the model directory search reduced the actual configured catalog to the requested model. Evidence: product-collaboration-desktop.jpg and product-collaboration-narrow.jpg. These offline functional passes do not claim live-provider quality, all visual fixture states, production disaster recovery or a formal M16 Gate.

### Approved production unit: data and Graph operations

Data now exposes full/thin export, exact missing-file hydration, configuration mappings with mandatory new preflight, explicit import acknowledgement, and managed backup status/download/recovery preflight. Existing targets reject import without overwrite. File selection, transport retry keys and modal focus remain scoped. Graph exposes ordered mouse/keyboard multiselect, confirmed archive, star relations, per-item results, manual partial resume and guarded Undo. Layout/zoom/collapse/filter changes save through the personal metadata API; default 80% zoom shows discussions, and zooming in requests Segment/Message neighborhoods.

Five data component cases passed. Graph/App/model coverage passed 50 cases after correcting one offscreen fixture; an additional regression proved partial Undo resumes the original inverse identity. Two affected default-zoom/neighborhood cases passed. The actual HTTP regression verified complete backup deduplication, thin-resource blocking and precise hydration, occupied target rejection, personal-view CAS and unchanged shared semantic/Journal facts, batch read/retry/Undo, and zero model calls. Final typecheck and affected lint passed.

The actual encrypted PGlite browser created a test discussion, batch archived it, read the receipt, undid it and saved personal state. Data generated a ready complete backup and correctly rejected recovery into its occupied original Workspace. Desktop and 390×844 screenshots: product-data-desktop.jpg, product-data-narrow.jpg, product-graph-desktop.jpg, product-graph-narrow.jpg. Narrow document width remains 390px. Marquee/modifier selection, comprehensive visual fixtures, production disaster recovery and formal Gates remain pending.

### Approved production unit: Workspace navigation and final review

Canonical Workspace URLs now locate discussions, exact Message/Segment identities, inline collaboration cards, provenance, Manifest/source indices, typed/versioned Graph objects, Runs, data/settings and resource metadata. Chooser/home/recents provide escape routes. State displays actual Context source facts. Browsing does not activate a discussion; explicit continuation waits for activation before dispatch. Archived locations are read-only. Recents contain only scoped canonical identity/time and are recorded after exact target validation; Graph presentation and message scroll/focus are restored on Back.

Independent review identified execution-target, typed Graph resolution, off-discussion child visibility, omission indexing, archived mutation and exact Run state defects. They were repaired with regressions. A further ownership review found that the recent collaboration list cannot prove ordinary-node ownership: the existing scoped ListCollaborations query now accepts a nodeId filter over all latest encrypted records before limiting results. Failed ownership reads reject generation. No schema, persisted content format, credential handling or write boundary changed.

Verification: the unified unit run had 490 passes and three failures; both Workspace fixtures were corrected to return their requested scope/home identity and the empty Runs surface was preserved. The affected eight-file run passed 87 cases, with the archived-Segment disabled control then repaired and passing. New ownership/history cases, Run terminal-state regression and real HTTP/PGlite ownership/frozen-source checks passed after bounded fixture repairs. A Run outside the recent list now refreshes through its exact scoped identity on manual refresh and polling; the running-to-completed App regression passed. E2E had 151 passes, 94 existing conditional skips and two failures: the compatible rollback revision was updated after migration checksum verification and passed; the M08 fixture now explicitly selects Segment/file sources under Assisted semantics and passed without weakening its five-source-family assertion. Full lint/build/license/M02/M04/M10 checks passed; subsequent affected lint/type/build and M02 passed. Final build passed after removing two unsupported Testing Library role-query options, retaining the exact string names and assertions.

Actual browser: Graph inspect → open discussion → Back restored selection/zoom; provenance → original Manifest → source 0 survives reload with original frozen content. Desktop 1440×900 and narrow 390×844 screenshots are product-navigation-desktop.jpg and product-navigation-narrow.jpg. The desktop capture was taken after the frozen content loaded and the viewport reached 1440px without horizontal overflow. Narrow page and sheet are both 390px; Escape from a reloaded source returns to the owning discussion with an enabled composer, while Escape after in-app source navigation returns exactly one level to its Manifest. Marquee/modifier and presentation restoration have component regressions; complete visual fixtures and formal visual-model acceptance remain pending.

Remaining delivery constraints: static G0 approval and full G0 performance evidence remain separate. M17 Command p95 remains 242.41ms against 200ms in the recorded measurement, without a new performance run. Real PostgreSQL was not configured for the existing conditional cases. Live-provider quality, production staging/recovery, backup expiry, long observation, dogfood and new-user acceptance remain unperformed. No formal milestone Gate is marked passed.

### Approved production unit: exact ResourceVersion content

Frozen Context sources and attachments now open the exact original ResourceVersion, including versions absent from the current attachment list. The authoritative scoped query validates ownership, Purge overlay and exact bytes inside the existing transactional UoW. Text is escaped, large/binary content has explicit download, failures require manual retry and never substitute another version. Download permission/missing/corruption/Purge errors clear previously displayed content and successful recents; successful Purge invalidates pending resource reads/downloads. Historical inputs and model dispatch remain unchanged.

Actual PGlite HTTP evidence covers original vs newer versions, text/context/binary/large previews, exact download bytes, headers, missing/corrupt/foreign/Purged resources, empty-store reads and unchanged Journal/Receipt/Run/Manifest facts: three new E2E cases pass. New frontend regressions cover exact identity, Workspace-switch stale responses, explicit retry and known permanent invalidation; the final affected App resource group passes eight cases. An independent review found the known-Purge cache invalidation gap and the repair above closes it. Prior resource component/API regressions, affected lint, build/typecheck and strict M02 passed. The new `m15:checks` run passes all four engineering groups. `m18:checks` passes views/batches but its navigation group exposed eager source derivation; the route-scoped repair removes all uncaught exceptions, while four shared UI refresh regressions remain unresolved. Their failure is retained, not marked passed.

Actual desktop 1440×900 and narrow 390×844 viewing, exact-link reload, frozen-source return and Escape Back are verified; screenshots are `product-resource-desktop.jpg` and `product-resource-narrow.jpg`. Download event observation timed out, but both browser-created files were found at 1117 bytes and SHA-256 `444ab4e7d5855043cb9946730b2d0070d0d3c18b3c95b15685e7c647ba01ad09`, exactly matching the visible version digest. No extra download loop was run. The temporary viewport was reset and the formal RHIZA tab retained.


### Approved production unit: Graph Context Tray and shared layers

Discussion/Segment selection uses the existing marquee, modifier and keyboard/list path. A dedicated drag handle and review button feed the same read-only Tray preview. Preview displays the current execution discussion, exact source revisions and the budget computed from actual active-source contents. Explicit confirmation rechecks scope, target, all revisions and budget within one UoW. Stable identities survive uncertain transport; definitive conflicts require fresh review and a new identity. Old manual selections without revisions retain their existing behavior. Version conflicts cannot be swallowed by the legacy planning fallback. Message/Manifest/history formats remain unchanged.

Object and relation layer toggles, search/status/date filters can be shared and restored through the canonical Graph-root URL. They affect presentation only. Persistent recents remove search text and discard older query-bearing entries. Existing personal-state CAS and bounded neighborhood queries are reused.

Actual RHIZA browser flow: selected the `图谱交付验证` discussion and `首屏信息架构` Segment by checkbox/Space, reviewed 5 + 30 tokens and exact revisions, confirmed, returned to `信息架构方向`, then continued offline Chat. The new Manifest contains both reviewed sources plus the two already active sources, with the same reviewed revisions and a total of 159 tokens. Back restores selection and shared layers. Desktop native dragging into the Tray triggers the same two-source review; the subsequent current-source budget is 179 tokens after the new Chat. Narrow 390×844 confirmation succeeds; the document width is exactly 390px and the confirm button remains visible. A sticky action footer repairs the initially clipped confirmation controls. The temporary viewport is reset. Screenshots: `product-tray-desktop.jpg`, `product-tray-narrow.jpg`, `product-tray-manifest.jpg`.

Targeted evidence: six-file frontend group 135 passes; changed layer/model five pass; runner/Tray final group 17 pass; navigation privacy 42 pass; real-content helper/PGlite six pass; stale-source Application plus existing planner 29 pass; new definitive-conflict identity regression passes after correcting its expected normalized error copy. Independent review found and closed the legacy fallback and persistent-query defects. No model invocation occurs during preview. Full fixed-state visual-model acceptance remains unperformed and is not marked PASS.

Final sweep: `pnpm run test` ran the unit suite once (610 pass / six failures); because its unit exit was nonzero, `pnpm run test:e2e` was then invoked explicitly and passes 158 with 94 existing conditional skips. The six unit failures came from concurrent UI tests captured before their implementation and the M02 fixture during repair; changed Activity (three), Run/navigation/App scopes and M02 subsequently pass. Final `m18:checks` passes views (two), batches (seven), Context Tray (11) and navigation UI (157). A separate staged-source copy verifies the scoped commit without taking ownership of concurrent UI edits: typecheck passes, 133 frontend cases pass, and the three remaining fixture/mock-isolation repairs pass in their affected scope. This is scoped recovery of recorded failures, not an unchanged whole-suite rerun.
