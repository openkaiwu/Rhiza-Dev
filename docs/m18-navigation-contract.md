# M18 Workspace navigation contract

Status: approved specification implemented in the formal product, including scoped canonical routes, exact historical versions, guarded recent locations and Back restoration. Production evidence is in the [UI audit](../reports/m15-m18/design/audit.md). Full visual acceptance and the M17/M18 Gates remain pending; this document alone does not close INH-290 or INH-148.

Scope: [INH-290](https://linear.app/inhandy/issue/INH-290/m18ia-contract-workspace-navigation-route-view-hierarchy-semantics) supplies the navigation semantics for [INH-148](https://linear.app/inhandy/issue/INH-148/m18ia-workspace-中心导航面包屑与最近访问). It complements the [compact workbench contract](../reports/m15-m18/design/contract.md); it does not choose another visual style or change Domain, Kernel, HTTP, Bundle or persisted object identities. INH-290's dependency on M17 Final Gate remains unmet.

## 1. Evidence and vocabulary

The following records the pre-implementation baseline used to design this contract. The implemented behavior and its verification are recorded in the UI audit:

| Surface | Current source and behavior | Consequence for implementation |
| --- | --- | --- |
| Workspace and view | `src/App.tsx` owns the selected Workspace and `View`; `src/types.ts` supports `chat`, `graph`, `state`, `activity`, `runs`. There is no application URL parser or browser history restoration. | Route state belongs beside the App coordinator; AppShell remains composition only. |
| Discussion selection | `App.activateNode` calls `POST …/nodes/:id/activate`; `ActivateNode` changes persisted `activeNodeId` and current-node Context, and rejects archived nodes. | Browsing a historical reference must not reuse activation as a read helper. |
| Navigation tree | `Sidebar.pathFor` follows `sourceNodeId`, guards cycles and caps depth. It compresses long paths; archived discussions are excluded from the main tree. | Preserve branch ancestry, but distinguish it from containment and browser history. |
| Search | `WorkspaceSearch` scopes requests and discards stale results. Results identify a discussion or Segment; App searches loaded messages and uses a 50 ms scroll timer. | Preserve the exact returned object ID; do not manufacture a Message identity from matching text. |
| Graph | `GraphView` has local viewport/filter state. `graph-model.ts` presents Conversation, Segment and Message; App follows projected containment to open a discussion and scroll. | Selection, source navigation and Context confirmation are separate actions. A bounded projection is not an existence check. |
| Provenance and history | `MessageProvenance` displays refs as text; `ContextHistoryPanel` reads frozen Manifest sources. Existing tests cover missing references and stale history responses. | Add links through one resolver; never replace historical evidence with current content. |
| Other destinations | Run list/detail reads exist. `StateView` contains static examples and unconnected actions. There is no Resource browser or recent-access store. | Route definitions for these surfaces are requirements, not claims that the views already work. |

User-facing **discussion** corresponds to the existing Node / Graph `conversation` object. A **view** is a presentation of a Workspace, not a new Domain object. A **source location** identifies an existing object/version. A **navigation entry** is personal browser state, not a Journal event or portable Workspace fact.

## 2. Identity and URL grammar

Use an application-relative hash route: `<app-base>/#/workspaces/{workspaceId}/…`. The fragment keeps UI routes separate from existing `/api/v1/workspaces/:workspaceId/…` endpoints and can be loaded by the current Vite/static entry without adding HTTP routes. IDs are opaque: encode each path segment, decode once, reject malformed escapes/empty required segments, and never derive IDs from titles or array indexes. The existing accessibility `#workspace-main` skip link must become a focus action when routing is connected; it must not replace the route fragment.

The root `/#/workspaces` is the authorized Workspace chooser. `/#/workspaces/{w}` is a stable Workspace landing route with recent objects and access to all views. Opening `/` without a route may use the current bootstrap default and then **replace** the entry with its resolved Workspace route; it must not add a phantom Back step. Opening an explicit route must resolve that Workspace first and must never fall back to the default Workspace when it fails.

| User task / view | Canonical route below `/#/workspaces/{w}` | Identity and behavior |
| --- | --- | --- |
| Browse discussions | `/conversations` | Discussion index and empty state; entering it does not pick an arbitrary discussion. |
| Read a discussion | `/conversations/{n}` | Existing Node ID. Branches have the same route depth as main discussions. |
| Read a Segment | `/conversations/{n}/segments/{s}` | Validate `Segment.nodeId === n`; reveal the Segment even if collapsed. |
| Locate a Message | `/conversations/{n}/messages/{m}` | Validate `Message.nodeId === n`; show this exact Message version, including an older edit/regeneration. |
| Inspect Message provenance | `/conversations/{n}/messages/{m}/provenance` | Load existing provenance for `m`; expose referenced objects as typed links only when the type is established. |
| Inspect Message Context | `/conversations/{n}/messages/{m}/context` | Resolve `m`'s recorded Manifest through the existing Message Context query. |
| Inspect a Manifest directly | `/context/manifests/{manifestId}` | Resolve the immutable Manifest, its owning discussion and frozen sources. Do not redirect to current Context. |
| Inspect one frozen source | `/context/manifests/{manifestId}/sources/{index}` | Zero-based index in the immutable ordered `contextItems`; validates the Manifest before resolving the index. Retains distinct repeated references and missing-source records. |
| Manage current Context | `/context` | Current Workspace execution selection; label its selected discussion. Mode/confirmation changes remain explicit Commands. |
| Browse Graph | `/graph` | Workspace graph; default Conversation level. Viewport/filter/selection restoration is personal state. |
| Locate a Graph object | `/graph/objects/{objectType}/{objectId}` | Existing scoped ObjectRef; optional `?versionId={v}` when the reference has one. Focus/select without adding to Context or activating Chat. |
| Browse resources | `/resources` | Existing Workspace resources, with attachment and frozen-source distinctions. No filesystem path in URL. |
| Inspect a resource/version | `/resources/{r}` or `/resources/{r}/versions/{v}` | `v` is a ResourceVersion ID, not its ordinal. Verify that it belongs to `r` and `w`; historical links always use the version route. |
| Knowledge state | `/state` | Workspace State view; no fabricated State-item IDs or deep links from the current static examples. |
| Execution history | `/runs` or `/runs/{runId}` | Read the scoped list or exact Run; Replay/retry/Stop remain explicit actions. |
| Semantic activity | `/activity` | Workspace Journal-derived activity, not runtime token events. |
| Inspect collaboration in a discussion | `/conversations/{n}/collaborations/{sessionId}` | Reveal the existing collaboration as a card inside Chat. Validate its frozen `base.nodeId === n` and Workspace membership; no invocation on navigation. There is no separate Collaboration page or primary destination. |
| Workspace data utilities | `/data` | Import/export/backup entry for this Workspace; entering it performs no file write or activation. |

Global Provider settings use `/#/settings/providers`. Opening them preserves the originating Workspace navigation entry and returning restores it. They are labelled global and do not silently select a Workspace or change its model preference. Workspace chooser/settings are the only exceptions to a Workspace-rooted content route.

Only the Graph version qualifier above is part of the URL contract. Search text, drafts, selection sets, pan/zoom, credentials, absolute paths, frozen content and projection cursors do not go in URLs. Copy-link emits the canonical resolved location; it excludes transient UI state. Titles can change without changing a link. Unknown route shapes show an unsupported-location state; an unknown Graph object type can show an authorized metadata-only inspector, but must not be cast to `conversation`.

## 3. Resolution and execution boundaries

Resolve in order: route syntax → authorized Workspace → object existence/lifecycle → membership/parent/version consistency → render → focus/position. Clear old Workspace data and invalidate in-flight history, search, Graph and mutation callbacks before loading another scope. Keep the existing request-generation guards; a late response must not move the URL, add a recent entry or overwrite the new scope.

Route display identity is distinct from the Workspace's persisted execution selection. Initial deep-link resolution, reload, Back/Forward, Graph selection, provenance inspection and frozen-source inspection are reads. They must not invoke `ActivateNode`, restore archives, select models, change Context, dispatch a Run or retry a command.

An explicit user action to continue a different active discussion uses the existing `ActivateNode` Command. Before sending or showing its editable current Context, await activation and reconcile the returned Workspace. If activation fails, keep the requested discussion visible in read-only mode with retry/back actions; never send against the previously active Node. Navigating away from a running generation does not cancel it. Stop remains explicit and execution reconciliation stays scoped to its originating Workspace. This separation is frontend orchestration, not a replacement Domain selection contract.

Historical Message links are exact-version links: reveal the requested Message even when Chat normally groups revisions. `versionGroupId`, reply position and “latest” do not replace its ID. Provenance `inputRefs`, parent revisions and branch sources require typed resolution from known facts; ambiguous/missing refs remain visible as unavailable references instead of guessed links. Model/endpoint/runtime refs are metadata, not browser URLs or actionable credentials.

Frozen-source links preserve the recorded Manifest, source index, ResourceVersion and digest. A separate **打开当前来源** action may navigate to the live object after scope and identity checks. Neither action confirms a recommended Context item. A missing Blob, failed digest or purged version remains a failure at the historical location; no current-version substitution or automatic Replay is allowed.

Search opens the exact returned discussion/Segment route. A search result is not a Message deep link unless a real Message ID is available. Any highlighted excerpt is presentation only. Graph **打开讨论/来源** uses the same resolver and containment checks as search; it must not infer non-existence from the first bounded page, load every page without a bound, or treat a display filter as authorization. A targeted scoped object/neighborhood read may resolve an offscreen object.

## 4. Breadcrumbs, Back and position

Breadcrumbs express semantic containment, not the user's click trail:

- Discussion: `Workspace → 讨论 → discussion`.
- Segment/Message: `Workspace → discussion → Segment (when known) → Message (when selected)`.
- Message history: append `来源` or `当时的上下文` to that exact Message location.
- Direct Manifest history: `Workspace → owning discussion → 历史上下文 → recorded time`; add an output Message only when a real link establishes it.
- Graph: `Workspace → 图谱 → selected object`, with type visible. The selected object does not become the active discussion merely by inspection.
- Resource version: `Workspace → 资源 → resource → version`; Runs use their own view/list then object. Collaboration stays under `Workspace → 讨论 → discussion`, with its card as an inspectable location in that conversation.

Discussion branch ancestry belongs to the existing tree/path control. `sourceNodeId` is derivation, so it must not pretend a branch is physically contained inside another discussion or make canonical URLs grow with branch depth. Cycle or missing-parent handling remains bounded. Long breadcrumbs retain Workspace and current object; intermediate segments collapse into a keyboard-accessible menu.

Use browser history as the single navigation stack. User-opened destinations **push** one entry; normalization, status refresh, pan/zoom, filter changes and a selected-object change within the same Graph inspection **replace/update** the current entry. A failed explicit target remains an entry so Back returns to where it was opened. Back/Forward never pushes a new entry or repeats domain Commands. Avoid pushing identical canonical destinations.

Before leaving a location, capture a personal restoration record keyed to that browser entry: Workspace/route identity, view scroll, visible Message/Segment anchor ID plus pixel offset, focused control's stable key, Graph viewport and filters, expanded discussion/Segment IDs and open panel state. Prefer the semantic anchor over an absolute scroll offset; restore only after the destination content is mounted. If an anchor disappeared, keep the parent location and explain that the exact position is unavailable. Do not jump to a similarly worded Message. Remove the current fixed-delay scroll assumptions.

Restoration records live in bounded tab memory (at most 50 recent navigation entries); store only the entry key and canonical route in `history.state`. They are not Domain/Journal/Bundle facts. When the tab reloads or an entry is evicted, resolve the URL, focus its heading/object, and use the view's ordinary initial position; exact pixel restoration is not promised across reloads. Never retain message bodies, previews, credentials, Resource bytes or undoable Purge content in restoration records. Revalidate IDs before restoring after a scope change or deletion.

An addressable inspector/sheet opened by navigation gets one history entry. Close/Escape consumes that entry when it has a recorded in-app parent; a directly loaded inspector closes by replacing its canonical parent location. It must not unexpectedly leave Rhiza via `history.back()`. Non-addressable transient UI (search palette, tooltip, confirmation dialog) closes without history mutation. Return focus to the opener when it still exists, otherwise to the destination heading. **返回当前上下文** explicitly opens `/context`; it is different from Back to the historical caller.

## 5. Recent access and Workspace switching

Recent access is per browser profile **and per authorized Workspace**. Keep at most 20 successful unique destinations per Workspace, newest first. Dedupe by canonical object/view/version location and update the timestamp after successful resolution. Back/Forward visits count; hover, failed navigation, partial loading and automatic refresh do not. A Workspace chooser may show a Workspace-level last-visited timestamp, but must not mix object entries from different Workspaces.

Persist only a versioned record of `{workspaceId, canonicalLocation, visitedAt}` in browser storage. Resolve display names/types from the currently authorized data; do not persist title, excerpt, source text, query text, attachments or response payloads. Invalid storage fails closed to an empty list and cannot prevent the app from loading. Recent access is device-local, excluded from Bundle/Journal and not proof of object access. Provide **清空最近访问** as an explicit personal-state action.

A successful Workspace switch lands on that Workspace's last valid location for this tab, otherwise on its Workspace landing route. A direct link always wins over saved recency. A known archived recent target remains labelled archived; a missing/purged/unauthorized target is removed when revalidated. If opening a stale recent target fails, show the unavailable destination with Back/Workspace chooser instead of silently redirecting to another discussion. Membership loss clears this Workspace's in-memory data and recent entries. Never display cached titles while access is unresolved.

## 6. Failure and lifecycle behavior

| Result | Required UI and navigation outcome | Forbidden fallback |
| --- | --- | --- |
| Loading | Preserve the requested route; show scoped loading and cancel/back where applicable. Hide previous Workspace content. | Rendering old-scope messages beneath a new Workspace title. |
| Empty authorized Workspace/list | Show Workspace identity, view title and real available entry actions (e.g. create discussion/import). Other views and chooser remain reachable. | Seeded/fabricated discussion or fake State facts. |
| Archived Workspace | Authorized content is visibly read-only; explicit existing Restore action for authorized actors. Keep exact URL. | Implicit restore, send, Context mutation or model invocation. |
| Archived discussion/Segment | Show an archived read-only location with parent/Back and explicit Restore when supported. Retain identity and history. | Activating the archived Node or replacing it with the first active Node. |
| Missing/purged object | Show unavailable at the requested location; provide authorized parent, Workspace and Back. A verified tombstone may say 已清除; otherwise say 不可用. Evict recent/cache references. | Recovering text from recents, old UI snapshots or current replacement objects. |
| Missing historical source or corrupt bytes | Keep Manifest/source explanation and recorded identity; distinguish the existing missing/integrity status; allow safe metadata reload. | Hydrating with a newer source or initiating Replay. |
| Unauthorized Workspace/object | Generic 无法访问此位置; chooser and Back. Do not reveal target title, members, existence, archived state or private breadcrumb ancestors. | Searching other Workspaces for the same ID or trusting cached labels. |
| Parent/version/scope mismatch | Invalid/unavailable location; no data from the mismatched object. | Correcting the Workspace/Node in the URL by guessing a global match. |
| Offline/transient read error | Same route with retry and Back; retain only already-authorized same-scope data and label it stale. | Resetting to the legacy default Workspace or treating errors as empty results. |
| Unsupported type/route | Known authorized metadata may be shown without unsupported actions; otherwise unsupported-location page with chooser. | Reinterpreting arbitrary refs as discussion IDs or external URLs. |

Read-only means mutations are disabled with a reason, not merely that the composer is hidden. Existing server permission/scope/lifecycle checks remain authoritative; no new permission inference comes from the URL. The app must not assume that every 404 proves a target never existed.

## 7. Desktop and narrow hierarchy

Apply the preview's shell behavior: collapsible sidebar, one main title layer, optional Context surface and full-width Graph by default. At every width preserve the current Workspace name, current view/object identity and a discoverable way back. On narrow screens retain the labelled Chat / Graph / History / Workspace navigation; Workspace exposes the full tree, State, Runs, Activity, Resources, data utilities and global settings. These can move into a drawer but cannot become unreachable. Start collaboration from an answer or the composer; its configuration, progress, participant outputs, synthesis and retention stay inside the current conversation. Inspecting internal output branches must not switch the active discussion. Explicit retention creates the existing referenced Message in the initiating discussion, allowing ordinary Chat to continue from the result and disagreements.

Context is the same addressable location whether shown as a rail, drawer or bottom sheet. A responsive change must not alter its Workspace, historical Message/Manifest or browser-history depth. A narrow screen may compress intermediate breadcrumbs; it must not replace Workspace and current object with an unlabeled icon. Long names truncate visually with the full accessible name available. Archived/history mode stays visible beside the relevant identity. Opening/closing drawers uses focus containment/return and Escape; it does not modify Context selection.

## 8. Implementation gaps and acceptance

The following gaps must be closed after preview approval; this document does not authorize bypassing missing API contracts:

1. Add a typed frontend location parser/formatter and coordinator resolver, hash navigation and Back/Forward handling. Replace independent `setView` destinations, text-inferred Message scrolling and route-clobbering skip links with the shared seam. Reuse existing HTTP scope and AppShell boundaries.
2. Separate viewed discussion/history identity from execution `activeNodeId`; gate explicit continuation/send on successful existing activation. Current Chat rendering falls back to the first navigable or initial example Node; explicit missing/archived routes must never use that fallback.
3. Wire common breadcrumbs, chooser, recent access and read-only/error surfaces. Current Sidebar footer archive/all-project buttons lack handlers; new landing/archive entry points must be real. No persisted recent store currently exists.
4. Give provenance/history real typed links and precise frozen-source locations. Existing scoped `GET …/context/manifests/:manifestId` exists server-side but has no frontend API helper. Resource IDs/versions are not exposed in the current Attachment DTO; generic Resource content browsing is not a current HTTP capability. Use existing authorized Graph metadata and Manifest history where sufficient; if standalone version reads need an additional public API, report `CONTRACT_CHANGE_REQUIRED` before implementation. Do not scrape storage, repurpose Blob paths or claim full Resource navigation from metadata alone.
5. Graph selection, position restoration and personal layout need their own implementation. Existing Graph coordinates are saved via domain layout handling; this navigation contract cannot silently migrate those facts or claim that all current layout is personal. Preserve Graph projection checkpoints/pagination bounds and the graph-model adapter.
6. State remains static example content and inline Collaboration remains unwired in production Chat. Do not mark production acceptance complete from the prototype. State-item identity/source navigation requires existing real facts or a separate reviewed contract; this document defines only the State view location. Collaboration reuses existing frozen-base, participant Retry/Stop, synthesis and Retain commands; it adds no new Domain identity or persisted format.

Required evidence for INH-148 is a bounded implementation regression plus fixed desktop/narrow screenshots with a visual PASS. Tests should extend the existing `src/App.test.tsx`, `GraphView.test.tsx`, `MessageProvenance.test.tsx`, `ContextHistoryPanel.test.tsx` and AppShell coverage rather than duplicate their assertions. Add route parser/coordinator tests for behavior not currently covered. At minimum demonstrate:

- A copied discussion, old-version Message, Manifest and frozen-source URL survives reload and resolves the exact scope/identity; rejected encoded/mismatched targets reveal no other scope.
- Graph → Message/history → Back restores the Graph position, filters and selection; search → Segment → Back restores its caller. These actions do not invoke a model or mutate Context.
- Rapid Workspace A → B switching, stale history/provenance responses and Back to A preserve scope guards; no old data flashes and no default-Workspace fallback occurs.
- Archived, missing, unauthorized, empty, offline and corrupt-history destinations each retain a working escape route. Existing explicit Restore/Replay/Purge safeguards still apply.
- Recent entries remain scoped, deduped and bounded; titles/content are not persisted, invalid storage is recoverable, and purged/unauthorized entries cannot restore old content.
- Desktop and 390px narrow screenshots show Workspace/current object, long-name handling, focus return, no horizontal overflow and consistent Back behavior. Record navigation steps for Workspace switch → discussion, Graph → source and Message → frozen Context; each visible task needs one destination action once its navigation surface is open.

Project commands are defined in `package.json`: `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and targeted `pnpm vitest run … --maxWorkers=1 --testTimeout=30000`. This documentation-only change needs link/path inspection and `git diff --check`; running the production test suite would not prove unimplemented routing. Formal M17/M18 gates and deferred external evidence remain separate from this contract.
