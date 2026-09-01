# Design QA

## Comparison target

- Source visual truth:
  - `/tmp/rhiza-ui-preview.Fq26oJ/design-qa-evidence/source-sidebar-bug.png`
  - `/tmp/rhiza-ui-preview.Fq26oJ/design-qa-evidence/source-run-history-bug.png`
- Browser-rendered implementation:
  - `/tmp/rhiza-ui-preview.Fq26oJ/design-qa-evidence/sidebar-fixed-1920x1044@2x.png`
  - `/tmp/rhiza-ui-preview.Fq26oJ/design-qa-evidence/run-history-fixed-1920x1044@2x.png`
- Combined comparison evidence:
  - `/tmp/rhiza-ui-preview.Fq26oJ/design-qa-evidence/sidebar-comparison.png`
  - `/tmp/rhiza-ui-preview.Fq26oJ/design-qa-evidence/run-history-comparison.png`
- Viewport: 1920 x 1044 CSS pixels; browser reported device pixel ratio 2.
- Pixels: source images are 3840 x 2088 and were normalized to 1920 x 1044 in the combined comparisons. In-app Browser captures are 1849 x 1044 because the Codex browser panel clips the deliverable surface; layout measurements came from the full 1920 x 1044 page viewport.
- State: desktop layout. The source showed a populated execution history; the isolated local database used for verification had no Run records, so the browser captured the empty row and measured the shared row selector that applies to populated rows.

## Findings and comparison history

### Initial findings

- P1 — Workspace actions collapsed into a narrow implicit grid track.
  - Evidence: the source showed `新建`, `重命名`, and `归档` wrapping one Chinese character per line.
  - Fix: made the action group an explicit full-width grid row, laid out its controls horizontally, and prevented button-label wrapping.
- P1 — Execution history content occupied the fixed 58px activity icon track.
  - Evidence: the source showed every Run article compressed into the left edge of an otherwise full-width timeline.
  - Fix: made RunHistory timeline rows single-column blocks while preserving the three-column layout for the ordinary activity timeline.

### Post-fix evidence

- Workspace card: the action row renders at 195px wide; all three buttons render at about 61.7px wide with `white-space: nowrap`. No label is vertical or clipped.
- Run history: the timeline renders at 1306px wide and its row at 1304px wide with `display: block`. The empty-state content spans the row; populated Run articles use the same row selector and keep their existing `width: 100%` rule.
- Primary interactions tested: dismissed onboarding, opened Execution History from the sidebar, and used the page refresh control state without console errors.
- Console errors and warnings checked: none.

## Required fidelity surfaces

- Fonts and typography: existing local Manrope/Newsreader/DM Mono stack and hierarchy are unchanged; the affected Chinese labels now stay horizontal.
- Spacing and layout rhythm: workspace actions form one balanced row inside the existing card; RunHistory rows use the intended full timeline width.
- Colors and visual tokens: existing semantic tokens are reused; no new color values or gradients were introduced.
- Image quality and assets: no product imagery or raster assets are involved; existing Lucide and ParticleMark assets are unchanged.
- Copy and content: all workspace and RunHistory labels are unchanged.

## Focused comparison

Focused region evidence was required because the defect is localized and small in a full-width screenshot. The combined comparison images preserve the full screen for context, while browser-computed widths verify the two affected regions precisely.

## Remaining test gap

- Browser visual verification used the empty RunHistory state because the isolated local database contained no durable runs. The populated state is covered structurally by the same corrected row selector and existing component fixtures, but was not browser-captured against seeded production data.

## Final result

final result: passed
