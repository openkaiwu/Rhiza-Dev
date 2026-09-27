# M09 Replay browser check (partial)

2026-09-27, isolated Embedded PGlite store and a local OpenAI-compatible fixture endpoint; no external model or user Workspace data was used.

- At 1440×900, sent a Chat message, saw the committed assistant response, opened Run History, selected Exact and created a second completed Run. The UI reported `回放已完成：exact。`; the new Run (`7b3a6f51-d2df-4524-adac-e184331f9219`) displayed the original Run (`680a0891-f71e-41bb-acdc-5ec429b0fcca`) as its retry source. [Desktop screenshot](replay-desktop.jpg).
- At 390×844, the Run History main surface previously exceeded the clipped app shell without its own scroll range. The mobile height/padding fix makes it scrollable; the Replay selector and action are visible above the bottom navigation. The closed Context drawer now sits fully outside the viewport, while the open drawer remains fixed. [Narrow screenshot](replay-narrow.jpg).

This checks one successful Exact path with a local fixture. It does not close Replay's four-classification coverage, real-provider behavior, PostgreSQL staging, Purge, or the M09 Gate.
