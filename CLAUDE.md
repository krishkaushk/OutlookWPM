# OutlookWPM — Claude Context

## What This Is
A WPM typing racer disguised as an Outlook Web compose window. Pure vanilla JS/HTML/CSS — no frameworks, no build step. Open `index.html` directly in a browser.

## File Structure
```
OutlookWPM/
├── index.html        HTML shell — all rows, IDs, data-attributes; no logic
├── style.css         Full visual layer — CSS custom properties, states, animations
├── game.js           All game logic — state, text pools, event handlers, render loop
├── Inspo/            Reference screenshots of Outlook Web compose popup
└── Elements          Raw F12 HTML dump of user's Outlook Web (dark mode)
```

## Running
Just open `index.html` in a browser. No server needed.

## Design Source of Truth
The `Elements` file is the user's real Outlook Web F12 DOM export (dark mode). Key verified CSS variables from it:
- `--composeNeutralBackground: #242424` (dark mode compose bg)
- `--composeNeutralLighterBackground: #fff` (body text area stays white even in dark mode)
- `--neutralLighterAlt: #1F1F1F` (title bar — same in dark and light modes)
- `--oobePrimary: #0078d4` (accent blue — consistent across modes)
- `--oobeDarkAlt: #106EBE` (hover accent)

The prompt specifies **light mode** values. Build light mode unless told otherwise.

## Exact Color Palette (Light Mode)
```css
--font-body:      Calibri, sans-serif        /* email body text */
--font-ui:        "Segoe UI", sans-serif      /* all chrome text */
--color-accent:   #0078d4                     /* active chips, cursor, WPM */
--color-accent-hover: #106ebe                 /* button hover */
--color-window-bg: #ffffff                    /* compose window */
--color-toolbar-bg: #f3f2f1                  /* formatting toolbar */
--color-border:   #8a8886                     /* window border, chip outlines */
--color-divider:  #edebe9                     /* row separators */
--color-title-bar: #1f1f1f                    /* always dark regardless of mode */
--color-char-untyped: #a19f9d                 /* not yet typed */
--color-char-correct: #201f1e                 /* correctly typed */
--color-char-incorrect: #a4262c              /* error text */
--color-char-incorrect-bg: #fde7e9           /* error background tint */
--shadow-compose: 0 4px 16px rgba(0,0,0,0.18)
```

## Layout Measurements
| Element | Height | Notes |
|---|---|---|
| `.title-bar` | 40px | Dark bg, white "New Message" + 3 SVG controls |
| `.header-row` (From/To/Subject) | 36px | 1px `#edebe9` bottom border |
| `.cc-row` | min 36px, auto | Chips may wrap to 2 lines |
| `.toolbar` | 36px | `#f3f2f1` bg |
| `.body-area` | flex: 1 | Overflow-y auto, Calibri 15px |
| `.bottom-bar` | 48px | 1px `#edebe9` top border |
| `.compose-window` | 680px wide | max-height: 80vh, bottom-right anchored |

## Game Architecture

### State Object (single source of truth)
```js
const GameState = {
  mode: 'race',           // 'race' | 'passage'
  duration: 15,           // seconds (race mode only)
  passageLength: 'short', // 'short' | 'medium' | 'long' (passage mode only)
  textStyle: 'work',      // 'work' | 'casual'
  currentText: '',
  typedIndex: 0,
  errorSet: new Set(),    // indices where a mistake was made (permanent for accuracy)
  startTime: null,
  endTime: null,
  timerInterval: null,
  state: 'idle'           // 'idle' | 'active' | 'finished'
}
```

### Text Pool Rules
- **Work passages**: 9 pre-written corporate email passages, NO apostrophes/symbols/shift-required chars
  - Short (~35–50 words, 2 sentences): indices 0–2 → Passage/Short
  - Medium (~75–100 words, 4–5 sentences): indices 3–5 → Passage/Medium
  - Long (~120–160 words, 6–8 sentences): indices 6–8 → Passage/Long
  - Race+Work: randomly pick from ALL 9 passages (ignore length filter)
- **Casual**: Fisher-Yates shuffle of 250 common English words, slice and group into sentences
  - Word count scales with duration: `Math.ceil(duration * 1.5)` words for Race, 40 words for Passage/Short etc.

### Key Invariants
- `renderText()` only updates classes on existing spans (no full DOM rebuild per keypress) — rebuild only on `resetGame()`
- Errors are permanent in `errorSet` even if user backtracks; accuracy is penalized
- Timer uses `Date.now() - startTime` (not decrement) to avoid drift
- `bodyArea.scrollTop = 0` before showing results overlay
- `document` keydown listener guards: `e.key.length > 1 && e.key !== 'Backspace'` filters non-printable; also `e.ctrlKey || e.altKey || e.metaKey` check; `e.preventDefault()` when game is active to avoid Space/Enter activating focused chips

### WPM Formula
```
WPM = (correctChars / 5) / elapsedMinutes
correctChars = typedIndex - (currently wrong positions, not errorSet.size)
```
Note: if user backtracks and re-types correctly, that position is no longer "wrong" even if it's in errorSet. Count characters where `typedChar === expectedChar` at each typed position.

### Character Span Update Strategy
Do NOT rebuild all spans on every keypress. Instead:
1. `resetGame()` → clears #textDisplay, builds all spans fresh
2. `handleKeypress()` → only touches the span at `typedIndex - 1` (just typed) and `typedIndex` (new cursor). Update classes in-place.

## UI Mapping
| Outlook Element | Game Function |
|---|---|
| Cc: field | Mode selector (Race/Passage) + sub-options (15s/30s/60s/120s or Short/Medium/Long) |
| Font dropdown | Text style (Work = corporate passages, Casual = random words) |
| Subject: line | Live WPM + accuracy during run |
| Send button | Restart when finished |
| Close (X) | Reset to idle |
| Bottom-bar right | Countdown/count-up timer |

## Common Pitfalls
- **Space key conflict**: `document` keydown capturing Space while a chip button is focused will both type a space AND activate the button. Guard with `document.activeElement` check or `e.preventDefault()` when state is 'active'
- **Race+Work passage length**: Race mode hides the length chips, so `passageLength` stays at whatever it was last set to. `generatePassage()` for Race mode must NOT use `passageLength` — pick random from all 9 Work passages
- **Casual word count for long races**: 20 words ≈ 10s of typing. Scale to duration
- **Chip Tab/Enter**: `<button>` elements get Tab/Enter for free — no extra JS needed
- **Calibri fallback**: On non-Windows, falls back to Helvetica Neue then Arial. Acceptable for a Windows-first project
