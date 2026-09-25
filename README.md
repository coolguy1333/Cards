# APUSH Notecards

A single-page, self-contained flashcard site for AP US History notecards, covering Period 1 (1491–1607) through Period 3 (1754–1800).

**Live file:** `index.html` — open it directly in any browser, no build step or server required.

## Features

- **Flip cards** — click/tap any card to flip between front (term) and back (date, theme, and explanation).
- **Study Mode** — a full-screen, one-card-at-a-time view with Prev/Next navigation, keyboard support (← → to move, Space to flip, Esc to close), and a progress counter. Runs through whatever set of cards is currently filtered.
- **Search** — filters cards live by term, date, or theme.
- **Filters**
  - Period dropdown (All / Period 1 / Period 2 / Period 3)
  - Module range (From / To)
  - Year range (From / To) — matched against a year parsed out of each card's date

## Content structure

Cards are organized by **Period → Module**, matching the course's notecard organization. Each card stores:

| Field | Description |
|---|---|
| `mod` | Module number within its period |
| `term` | Front-of-card title |
| `date` | Display date/date range shown on the back |
| `theme` | AP US History theme (e.g. "Politics and Power", "America in the World") |
| `html` | Back-of-card explanation, with inline color-coded spans (`.b` key term, `.r` core fact, `.p` significance) |

## Editing / adding cards

All content lives in the `<script>` block at the bottom of `index.html`, in three arrays: `data1`, `data2`, and `data3` (one per period). To add a card, add an object to the matching array:

```js
{mod: 3, term: "New Term", date: "1770", theme: "Politics and Power",
 html: `<span class="b">Key phrase</span> ... <span class="r">core fact</span> ... <span class="p">why it matters</span>.`}
```

To add a new period, copy the pattern used for `data3`: define a `periodN` label, build the array, tag each entry with `d.period = N`, and add it to the `allData` spread and `periodLabels` map.

## Tech

Plain HTML/CSS/JS, no dependencies, no build step. Safe to host as-is on GitHub Pages.
