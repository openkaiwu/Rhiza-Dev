# M07 GraphView visual acceptance

Date: 2026-09-06. Result: PASS after fixes.

Reproduce with `pnpm run build` and `pnpm exec tsx scripts/preview-m07-graph.ts`, then open the printed local URL and select 对话图谱. The script creates an isolated disposable embedded database with 300 conversations, 299 chain relations and searchable source anchors. It uses the existing renderer, store and API; no additional runtime dependency is needed.

## Executed acceptance

| Check | Result |
| --- | --- |
| Progressive loading | 100 → 200 → 300 nodes; final 299 relations, including cross-page endpoints |
| Source-anchor search and zoom | 来源锚点 0 yields one node; Enter focuses it; zoom reaches 110% |
| Layout persistence | Drag issues a successful position PATCH; the graph reload retains the moved coordinates |
| Pan | Dragging empty canvas changes translation from (71,115) to (111,165) |
| Editing | Create a node (301 total), archive it (300 visible and one archived), restore it (301 visible), create a relation (300 relations) |
| Relation deletion and failed drag recovery | GraphView regression selects a relation and invokes deletion; a rejected position save restores the original coordinates and shows an error |
| Narrow viewport | 390 × 844; canvas width 370, focused node inside viewport; all five navigation entries and zoom controls visible |
| Persistence and semantic compatibility | Embedded SQL regression verifies the moved layout, old/new presentation equality, rebuild and three transaction failure points |

## Visual model review

The assistant inspected the saved screenshots directly. PASS: readable node labels, distinct current-node state, visible search/loading controls, separate canvas and archive region, coherent connection styles, and no overlap covering narrow-screen controls. The narrow-screen canvas and bottom navigation regressions found during inspection were fixed and recaptured.

- [Desktop first page](desktop-initial.png)
- [Desktop complete graph](desktop-loaded.png)
- [Desktop source search](desktop-search.png)
- [Narrow source search](narrow.png)

Automated gate results and commit-bound checksums are recorded in `evidence.json`. Real external PostgreSQL execution is skipped when `DATABASE_URL` is not configured; the embedded SQL suite runs the migration, layout and failure-recovery scenarios.
