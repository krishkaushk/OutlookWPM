# OutlookWPM — Claude Context

## What This Is
A WPM typing racer disguised as an Outlook Web compose window. Pure vanilla JS/HTML/CSS — no frameworks, no build step. Open `index.html` directly in a browser.

## File Structure
```
OutlookWPM/
├── index.html              HTML shell — all rows, IDs, data-attributes; no logic
├── style.css               Full visual layer — CSS custom properties, states, animations
├── game.js                 All game logic — state, text pools, event handlers, render loop
├── words/
│   ├── MonkeyEnglish.json  Common English words for Monkey mode
│   ├── CasualEnglish.json  Common English words for Casual mode
│   ├── corporateEnglish.json  Corporate email passages (short/medium/long buckets)
│   └── emailContent.json   Peek mode email content — openers, targets, closings
├── Inspo/                  Reference screenshots of Outlook Web compose popup
└── Elements                Raw F12 HTML dump of user's Outlook Web (dark mode)
```

## Running
Just open `index.html` in a browser. No server needed. Word pools are loaded via `fetch()` from the `words/` directory — use a local server (e.g. VS Code Live Server) if fetch fails due to CORS on `file://`.

## Design Source of Truth
The `Elements` file is the user's real Outlook Web F12 DOM export (dark mode). Build **light mode** unless told otherwise.

## Exact Color Palette (Light Mode — current CSS variables)
```css
--font-body:      Aptos, Calibri, "Helvetica Neue", Arial, sans-serif
--font-ui:        "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", Aptos, system-ui, sans-serif
--color-accent:         #0F6CBD
--color-accent-hover:   #115EA3
--color-accent-dark:    #0C3B5E
--color-window-bg:      #ffffff
--color-toolbar-bg:     #f3f2f1
--color-border:         #8a8886
--color-divider:        #edebe9
--color-title-bar:      #1f1f1f
--color-label:          #605e5c
--color-text-primary:   #323130
--color-text-secondary: #605e5c
--color-hover-bg:       #f3f2f1
--color-char-untyped:   #a19f9d
--color-char-correct:   #201f1e
--color-char-incorrect: #a4262c
--color-char-incorrect-bg: #fde7e9
--shadow-compose: 0 8px 32px rgba(0,0,0,0.28)
```

## Layout Measurements
| Element | Height | Notes |
|---|---|---|
| `.title-bar` | 40px | Dark bg, white "New Message" + 3 SVG controls |
| `.send-row` | 56px | Split Send button + From field + right action icons |
| `.header-row` (To/Cc/Bcc/Subject) | 36px | 1px `#edebe9` bottom border |
| `.bcc-row` | 36px | Hidden by default; shown when Bcc button clicked |
| `.toolbar` | 36px | `#f3f2f1` bg, ribbon controls |
| `.body-area` | flex: 1 | Overflow-y auto, `var(--font-body)` 17px |
| `.bottom-bar` | 48px | 1px `#edebe9` top border, timer only |
| `.compose-window` | 680px wide | max-height: 80vh, bottom-right anchored |

## Header Row Order (top to bottom)
1. Send row (split button + From + action icons)
2. To row — "WPM Racer" chip + **Bcc button** (far right, bordered box)
3. Cc row — mode/duration selector dropdown
4. Bcc row — hidden; appears when Bcc clicked; contains "Maximilian Larp" chip
5. Subject row — live WPM readout

## Game Architecture

### State Object (single source of truth)
```js
const GameState = {
  mode: 'race',           // 'race' | 'passage'
  duration: 15,           // seconds (race mode only)
  passageLength: 'short', // 'short' | 'medium' | 'long' (passage mode only)
  textStyle: 'corporate', // 'corporate' | 'casual' | 'monkey'
  peekMode: false,        // true = Maximilian Larp (Bcc row visible, 3-word window)
  words: [],              // current passage split into word strings
  wordIndex: 0,           // index of word currently being typed
  charIndex: 0,           // char position within current word
  correctChars: 0,        // for WPM calculation
  totalChars: 0,          // for accuracy (includes errors)
  startTime: null,
  endTime: null,
  timerInterval: null,
  state: 'idle'           // 'idle' | 'active' | 'finished'
}
```

### Text Pool Rules
- **Corporate** (`words/corporateEnglish.json`): pre-written email passages
  - Short (~35–50 words): `corporatePassages.short[]`
  - Medium (~75–100 words): `corporatePassages.medium[]`
  - Long (~120–160 words): `corporatePassages.long[]`
  - Race + Corporate: randomly pick from ALL passages (ignore length filter)
  - Passage + Corporate: pick from the matching length bucket
- **Casual** (`words/CasualEnglish.json`): Fisher-Yates shuffle, `Math.ceil(duration * 1.5)` words for Race; fixed counts (40/65/90) for Passage Short/Medium/Long
- **Monkey** (`words/MonkeyEnglish.json`): same assembly logic as Casual

### Peek Mode (Maximilian Larp)
- Toggled by clicking the **Bcc button** in the To row (bordered box, far right)
- When enabled: Bcc row appears with "Maximilian Larp" chip (plain red circle badge)
- Clicking Bcc again or the chip's X dismisses the row and disables peek
- **Word visibility**: only current word + next 2 are visible; words beyond `wordIndex + 2` get `.word-peek-hidden { visibility: hidden }`
- **Email framing**: `#emailGreeting` (e.g. "Hi Sarah,") and `#emailFooter` (e.g. "Best regards,\nAdmin") appear in the body area — only in peek mode
- Greeting/footer content driven by `words/emailContent.json` (openers, targets, closings)
- Footer name is derived from `#fromEmailDisplay`: take local part before `@`, split at first non-alphanumeric, capitalize first letter — updates live as the From field is edited
- Enabling peek calls `resetGame()`; disabling just removes peek classes + hides greeting/footer without resetting

### Key Invariants
- `renderText()` does a full span rebuild — only called by `resetGame()`
- `handleKeypress()` updates classes in-place; never rebuilds spans
- `handleKeypress` returns early if `document.activeElement.id === 'fromEmailDisplay'`
- Errors are reflected in real-time accuracy but NOT permanently locked — backspacing and re-typing correctly heals the position
- Timer uses `Date.now() - startTime` (not decrement) to avoid drift
- `updatePeek()` is called after every word advance (space key) and from `moveCursor()`; returns early if `!GameState.peekMode`
- Race mode appends more words via `appendMoreWords()` when within 5 words of the end
- Cc field cursor (`.cc-field-cursor`) is CSS-controlled via `.cc-field:focus` — the blink animation only runs on focus; `closeDropdown()` calls `$ccField.blur()`

### WPM Formula
```
WPM = (correctChars / 5) / elapsedMinutes
```
`correctChars` increments on each correct keypress (including spaces). Backspacing a correct char decrements it.

### Word-Based DOM Structure
Text is rendered as `.word[data-wi]` spans, each containing `.char` spans:
```html
<span class="word" data-wi="0">
  <span class="char">H</span>
  <span class="char">i</span>
</span>
```
Char classes: `correct`, `incorrect`, `missed` (skipped on space), `extra` (typed past word end), `cursor`

### Cached DOM Refs (top of game.js)
All elements are cached once at module level:
`$bodyArea`, `$textDisplay`, `$subject`, `$timer`, `$ccField`, `$ccTag`, `$ccDropdown`, `$ccRow`, `$bccRow`, `$btnSend`, `$btnSendLabel`, `$greeting`, `$footer`, `$draftSaved`, `$ccCursor`

## UI Mapping
| Outlook Element | Game Function |
|---|---|
| To: field | Static "WPM Racer" chip + **Bcc toggle button** (far right) |
| Bcc: row | Peek mode toggle — "Maximilian Larp" chip with red circle badge |
| Cc: field | Mode selector dropdown (Race 15/30/60/120s · Passage Short/Medium/Long) |
| Font family dropdown | Text style (Corporate / Casual / Monkey) |
| Font size input | Scales `$textDisplay`, `$greeting`, `$footer` font size in sync |
| Subject: line | Live "Re: WPM \| accuracy" during run; full stats when finished |
| From: field | Contenteditable — edits sync to nav sidebar; keypresses don't feed game |
| Send button | "New Message" / restarts game when finished |
| Close (X) | Resets to idle |
| Bottom-bar right | Countdown (race) or count-up (passage) timer |

## emailContent.json Schema
```json
{
  "openers":  ["Hi", "Hello", "Good morning", ...],
  "targets":  ["Sarah", "team", "everyone", ...],
  "closings": ["Best regards,", "Thank you,", ...]
}
```
Edit this file to change peek mode greeting/sign-off options without touching JS.

## Fluent UI System Icons (Microsoft SVG Icons)
All toolbar, nav, and action icons come from the **Fluent UI System Icons** library:

- **GitHub source**: `microsoft/fluentui-system-icons` → `assets/{icon-name}/SVG/`
- **Naming convention**: `ic_fluent_{name}_{size}_{style}.svg`
  - e.g. `ic_fluent_trash_can_20_regular.svg`, `ic_fluent_arrow_curve_down_left_20_regular.svg`
- **Size used**: `20` (rendered at 18–20px CSS)
- **Style used**: `regular` (outlined); `filled` exists for some icons
- **viewBox**: always `"0 0 20 20"` for 20px variants
- **How to find an icon**: search the repo by keyword (e.g. "filter", "shield", "window") — icon folder names match the concept. The SVG `<path>` can be copied directly inline.
- **Color**: set via CSS `color` + `fill="currentColor"` on the `<svg>` — never hardcode a fill color in the SVG markup itself
- **Current icon color**: `#424242` on nav folders and send-row action buttons

### Icon locations in the UI
| Location | Icons used |
|---|---|
| Nav folder panel | `ic_fluent_mail_20_regular`, `ic_fluent_send_20_regular`, `ic_fluent_archive_20_regular`, etc. |
| Inbox action bar | `ic_fluent_select_all_off_20_regular`, `ic_fluent_arrow_curve_down_left_20_regular`, `ic_fluent_filter_20_regular`, `ic_fluent_arrow_sort_20_regular` |
| Compose send-row (right) | `ic_fluent_shield_question_20_regular`, `ic_fluent_trash_can_20_regular`, `ic_fluent_window_new_20_regular` |

## Common Pitfalls
- **Space key conflict**: global `keydown` listener captures Space — guarded with `e.preventDefault()` when state is `'active'`
- **Race passage length**: `passageLength` is ignored in Race mode — always picks randomly from all corporate passages
- **`hidden` class is NOT global**: each element type has its own `.xxx.hidden { display: none }` rule. Adding `.hidden` to a new element type requires a matching CSS rule
- **Cc blue underline**: `.cc-row:focus-within::after` — only appears on focus, not always
- **Peek + appendMoreWords**: in Race mode, newly appended words won't have peek applied until `updatePeek()` is called (it's called right after `appendMoreWords()` in the space handler)
- **Font fallback**: Aptos is Windows 11 only; Calibri is the effective fallback on older Windows
