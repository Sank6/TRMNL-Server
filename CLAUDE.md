# Claude instructions for xteink-server

## Before designing or modifying any widget

Read `STYLE.md` in full before writing any SVG layout or widget code.
The display is 1-bit monochrome — visual decisions that seem minor (grey colours, spacing, optical centering) have a large impact on the final output.

## After implementing a widget

Always verify the result visually. Generate the widget and preview it via the dashboard PNG endpoint:

```
GET http://localhost:3001/api/widgets/:name.png
```

Check:
- Grid lines, dividers, and borders are visible (black, not grey)
- Content looks optically centered — not just mathematically centered
- Nothing feels crowded; there is breathing room around every element
- One dominant visual element is immediately obvious
- No grey fills or strokes on structural elements that could threshold to white

Do not consider the widget done until you have seen the rendered output.
