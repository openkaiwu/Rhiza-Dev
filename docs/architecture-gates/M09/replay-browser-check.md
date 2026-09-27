# M09 Replay browser check (partial)

2026-09-27, isolated Embedded PGlite store and a local OpenAI-compatible fixture endpoint; no external model or user Workspace data was used.

- At 1440×900, sent a Chat message, saw the committed assistant response, opened Run History, selected Exact and created a second completed Run. The UI reported `回放已完成：exact。`; the new Run (`7b3a6f51-d2df-4524-adac-e184331f9219`) displayed the original Run (`680a0891-f71e-41bb-acdc-5ec429b0fcca`) as its retry source. [Desktop screenshot](replay-desktop.jpg).
- At 390×844, the Run History main surface previously exceeded the clipped app shell without its own scroll range. The mobile height/padding fix makes it scrollable; the Replay selector and action are visible above the bottom navigation. The closed Context drawer now sits fully outside the viewport, while the open drawer remains fixed. [Narrow screenshot](replay-narrow.jpg).

On 2026-09-28, a separate clean-store browser import restored a Run-backed Workspace. The UI selected Current-model explicitly, created completed Run `29f9b27a-dc65-40aa-9cf5-a3db2b6b9b64` and displayed source Run `6a7e9012-5e99-4e9d-871a-7c80ee168775` as its parent. Its new Assistant output had recorded provenance pointing to the new Run and Manifest. See [desktop](clean-import-replay-desktop.png), [narrow Run History](clean-import-replay-narrow.png) and [narrow provenance](provenance-run-backed-narrow.png).

The scoped API E2E in `e2e/m06-runs.e2e.test.ts` additionally covers Exact, Partial, Current-model and Missing-resource decisions: changed Exact contracts fail, Missing-resource creates no Run or provider call, and the new Replay Run retains `parentRunRef` and the frozen source Manifest identity. These are local/isolated PostgreSQL fixtures; the browser checks above exercise two successful policies, not all four. External-provider, user-managed PostgreSQL staging, Purge and M09 Gate remain open.
