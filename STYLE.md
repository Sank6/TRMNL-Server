# Widget Design Style Guide

## Display constraints

- **Resolution**: 800 × 480 px
- **Colours**: strictly black and white — 1-bit monochrome BMP
- There is no middle ground. Do not use greys, shadows, opacity, or gradients — they will either disappear or turn into solid black blobs.

## Colour rules

- Backgrounds: white only (`fill="white"` or `#FFF`)
- All strokes and fills: black or white only (`stroke="black"`, `fill="black"`, `fill="white"`, `#000`, `#FFF`)
- Never use grey values, opacity, or "de-emphasised" colours. Hierarchy must come from size, spacing, weight, and placement, not colour.
- All structural elements (dividers, borders, grid lines) must use black only.

## Grid and layout

All layout is built on an invisible grid. Every element — text, icons, dividers — snaps to grid positions. The grid itself is never drawn unless a visible line is genuinely needed to separate content zones.

**Default grid**:
- Left/right margin: 44 px
- Bottom margin: 28 px (above branding)
- Top margin: varies by widget content
- Use consistent column and row intervals; derive coordinates from the grid rather than placing elements by eye

**When to draw a visible line**:
Only draw a `<line>` divider when there is a clear content boundary that whitespace alone cannot communicate — e.g. separating a header zone from a data zone when they would otherwise visually merge. Prefer whitespace. A line is a last resort, not a default.

**When NOT to draw lines**:
- Between items in a list
- Around cells in a grid unless the grid itself is the content (e.g. a calendar where cells need to be distinguishable)
- As decoration
- Between elements that already have sufficient breathing room

## Visual centering

Align content so it *feels* centered to the eye — not necessarily at the mathematical midpoint. Large text optically sits lower than its bounding box — compensate upward. After placing elements mathematically, ask: does this look balanced? Adjust if not.

## Breathing room

Leave generous empty space around and between elements. A widget should never feel crowded. If it looks tight, it is tight. Err on the side of fewer elements with more space rather than more elements packed in.

## Hierarchy

One dominant element per widget — a large number, time, icon, or phrase. Everything else is noticeably smaller and subordinate. If two things feel equally prominent, one of them shouldn't be there.

## Typography

- Font: `Arial, Helvetica, sans-serif` for UI/data. `Georgia, serif` only for editorial content.
- Sizes:
  - Hero value (time, temperature, big stat): 140–190 px
  - Section title / heading: 46–56 px
  - Labels and secondary text: 28–40 px
  - Branding / footnote: 20 px
- `font-weight="bold"` only on the primary value — not on labels or supporting text.
- `text-anchor="middle"` + `dominant-baseline="middle"` when centering text on a point.

## Icons / graphics

- SVG path/line icons only — no raster, no embedded images.
- Stroke weight: 9–11 px so lines survive 1-bit thresholding.
- No fine detail smaller than ~8 px — it will not survive.

## Dividers

When a divider is warranted: `<line x1="0" y1="..." x2="${W}" y2="..." stroke="black" stroke-width="1"/>` edge-to-edge.

## Checklist before finalising a widget

1. Is every element snapped to the grid?
2. Are there any drawn lines that could be removed and replaced with whitespace?
3. Does the layout breathe? No crowded sections?
4. Is there one clear dominant visual element?
5. Is the content optically centered — does it *look* balanced?
6. Render and inspect via the dashboard PNG preview (`GET http://localhost:3001/api/widgets/:name.png`) before considering it done.
