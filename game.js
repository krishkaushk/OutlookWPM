// ── State ────────────────────────────────────────────────────────────────────

const GameState = {
  mode: 'race',
  duration: 15,
  passageLength: 'short',
  textStyle: 'corporate',
  words: [],        // ['word1', 'word2', ...]
  wordIndex: 0,     // current word being typed
  charIndex: 0,     // position within current word (0 = before first char)
  correctChars: 0,  // for WPM
  totalChars: 0,    // for accuracy (all typed, including errors/extras)
  startTime: null,
  endTime: null,
  timerInterval: null,
  state: 'idle',
};

// ── Word pools — loaded from words/ JSON packages, tiny inline fallback ──────

let monkeyWordPool    = ['the','be','of','and','a','to','in','he','have','it'];
let casualWordPool    = ['the','be','of','and','a','to','in','he','have','it'];
let corporatePassages = {
  short:  ['Please find attached the updated report for your review. I have highlighted the sections that require sign-off before end of week.'],
  medium: [],
  long:   []
};

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $bodyArea    = document.getElementById('bodyArea');
const $textDisplay = document.getElementById('textDisplay');
const $subject     = document.getElementById('subjectValue');
const $timer       = document.getElementById('timerDisplay');
const $ccField     = document.getElementById('ccField');
const $ccTag       = document.getElementById('ccTag');
const $ccDropdown  = document.getElementById('ccDropdown');
const $btnSend     = document.getElementById('btnSend');
const $btnSendLabel = document.getElementById('btnSendLabel');

let $gameCaret; // created in DOMContentLoaded, appended to $textDisplay

// ── Text generation ──────────────────────────────────────────────────────────

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assembleWordText(pool) {
  let wordCount;
  if (GameState.mode === 'race') {
    wordCount = Math.ceil(GameState.duration * 1.5);
  } else {
    wordCount = { short: 40, medium: 65, long: 90 }[GameState.passageLength] || 40;
  }
  const words = shuffleArray(pool).slice(0, Math.min(wordCount, pool.length));
  return words.join(' ');
}

function generatePassage() {
  if (GameState.textStyle === 'monkey') return assembleWordText(monkeyWordPool);
  if (GameState.textStyle === 'casual') return assembleWordText(casualWordPool);
  // corporate
  if (GameState.mode === 'race') {
    const all = [...corporatePassages.short, ...corporatePassages.medium, ...corporatePassages.long];
    return all[Math.floor(Math.random() * all.length)];
  }
  const bucket = corporatePassages[GameState.passageLength] || corporatePassages.short;
  return bucket[Math.floor(Math.random() * bucket.length)];
}

// ── Rendering ────────────────────────────────────────────────────────────────

function getWordEl(index) {
  return $textDisplay.querySelector(`.word[data-wi="${index}"]`);
}

function buildWordEls(words, startIndex) {
  const frag = document.createDocumentFragment();
  words.forEach((word, i) => {
    const wordEl = document.createElement('span');
    wordEl.className = 'word';
    wordEl.dataset.wi = startIndex + i;
    for (let ci = 0; ci < word.length; ci++) {
      const span = document.createElement('span');
      span.className = 'char';
      span.textContent = word[ci];
      wordEl.appendChild(span);
    }
    frag.appendChild(wordEl);
  });
  return frag;
}

function renderText() {
  $textDisplay.innerHTML = '';
  if ($gameCaret) $textDisplay.appendChild($gameCaret); // re-attach after innerHTML wipe
  $textDisplay.appendChild(buildWordEls(GameState.words, 0));
  moveCursor();
}

function moveCursor() {
  $textDisplay.querySelectorAll('.char.cursor').forEach(el => el.classList.remove('cursor'));
  $textDisplay.querySelectorAll('.word.cursor-after').forEach(el => el.classList.remove('cursor-after'));

  if (GameState.state === 'finished') {
    if ($gameCaret) $gameCaret.hidden = true;
    return;
  }

  if ($gameCaret) $gameCaret.hidden = false;

  const wordEl = getWordEl(GameState.wordIndex);
  if (!wordEl) return;

  const allChars = wordEl.querySelectorAll('.char');
  const target = allChars[GameState.charIndex];

  if (target) {
    target.classList.add('cursor');
    target.scrollIntoView({ block: 'nearest' });
  } else {
    wordEl.classList.add('cursor-after');
    wordEl.scrollIntoView({ block: 'nearest' });
  }

  // Position caret div after any scroll has settled
  requestAnimationFrame(() => {
    if (!$gameCaret) return;
    const displayRect = $textDisplay.getBoundingClientRect();
    if (target) {
      const r = target.getBoundingClientRect();
      $gameCaret.style.left   = (r.left - displayRect.left) + 'px';
      $gameCaret.style.top    = (r.top  - displayRect.top)  + 'px';
      $gameCaret.style.height = r.height + 'px';
    } else if (wordEl.lastElementChild) {
      const r = wordEl.lastElementChild.getBoundingClientRect();
      $gameCaret.style.left   = (r.right - displayRect.left) + 'px';
      $gameCaret.style.top    = (r.top   - displayRect.top)  + 'px';
      $gameCaret.style.height = r.height + 'px';
    }
  });
}

function appendMoreWords() {
  const extra = generatePassage();
  const newWords = extra.trim().split(/\s+/);
  const startIndex = GameState.words.length;
  GameState.words.push(...newWords);
  $textDisplay.appendChild(buildWordEls(newWords, startIndex));
}

function updateSubject() {
  if (GameState.state === 'idle') {
    $subject.textContent = 'Re: Click to begin';
    return;
  }
  const wpm = calcWPM();
  const acc = calcAccuracy();
  if (GameState.state === 'finished') {
    const elapsed = elapsedSeconds();
    const errorWords = $textDisplay.querySelectorAll('.word.word-error').length;
    $subject.textContent = `Re: ${wpm} WPM · ${acc}% accuracy · ${errorWords} word errors · ${elapsed}s`;
  } else {
    $subject.textContent = `Re: ${wpm} WPM | ${acc}% accuracy`;
  }
}

function setTimerDisplay(elapsed) {
  if (GameState.mode === 'race') {
    const remaining = Math.max(0, GameState.duration - elapsed);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    $timer.textContent = mins > 0
      ? `${mins}:${String(secs).padStart(2, '0')}`
      : `${secs}s`;
    $timer.classList.toggle('urgent', remaining <= 5 && remaining > 0);
  } else {
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    $timer.textContent = mins > 0
      ? `${mins}:${String(secs).padStart(2, '0')}`
      : `${secs}s`;
    $timer.classList.remove('urgent');
  }
}

// ── Stats ────────────────────────────────────────────────────────────────────

function calcWPM() {
  if (!GameState.startTime || GameState.correctChars === 0) return 0;
  const endMs = GameState.endTime || Date.now();
  const elapsedMin = Math.max((endMs - GameState.startTime) / 60000, 1 / 60);
  return Math.round(GameState.correctChars / 5 / elapsedMin);
}

function calcAccuracy() {
  if (GameState.totalChars === 0) return 100;
  return Math.round((GameState.correctChars / GameState.totalChars) * 100);
}

function elapsedSeconds() {
  if (!GameState.startTime) return 0;
  const endMs = GameState.endTime || Date.now();
  return Math.round((endMs - GameState.startTime) / 1000);
}

// ── Game flow ────────────────────────────────────────────────────────────────

function startGame() {
  GameState.startTime = Date.now();
  GameState.state = 'active';
  $bodyArea.classList.remove('idle');
  updateSubject();
  const $ccCursor = document.getElementById('ccFieldCursor');
  if ($ccCursor) $ccCursor.hidden = true;

  GameState.timerInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - GameState.startTime) / 1000);
    setTimerDisplay(elapsed);
    updateSubject();
    if (GameState.mode === 'race' && elapsed >= GameState.duration) {
      endGame();
    }
  }, 250);
}

function endGame() {
  if (GameState.state === 'finished') return;
  GameState.endTime = Date.now();
  GameState.state = 'finished';
  clearInterval(GameState.timerInterval);
  GameState.timerInterval = null;

  moveCursor(); // clears cursor since state is now 'finished'

  const elapsed = elapsedSeconds();
  setTimerDisplay(elapsed);
  $timer.classList.remove('urgent');

  updateSubject();
  $btnSendLabel.textContent = 'New Message';
}

function formatDraftTime() {
  const now = new Date();
  let h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `Draft saved at ${h}:${m} ${ap}`;
}

function resetGame() {
  clearInterval(GameState.timerInterval);
  GameState.timerInterval = null;

  const text = generatePassage();
  GameState.words = text.trim().split(/\s+/);
  GameState.wordIndex = 0;
  GameState.charIndex = 0;
  GameState.correctChars = 0;
  GameState.totalChars = 0;
  GameState.startTime = null;
  GameState.endTime = null;
  GameState.state = 'idle';

  $timer.textContent = '';
  $timer.classList.remove('urgent');
  $bodyArea.classList.remove('idle'); // no overlay on reset — only tab-away adds it
  $subject.textContent = 'Re: Click to begin';
  $btnSendLabel.textContent = 'Send';
  $bodyArea.scrollTop = 0;

  const $draftSaved = document.getElementById('draftSaved');
  if ($draftSaved) $draftSaved.textContent = formatDraftTime();
  const $ccCursor = document.getElementById('ccFieldCursor');
  if ($ccCursor) $ccCursor.hidden = false;

  renderText();
}

// ── Input handling ───────────────────────────────────────────────────────────

function handleKeypress(e) {
  if (e.key === 'Tab') { e.preventDefault(); resetGame(); return; }

  if (GameState.state === 'finished') {
    if (e.key === 'Enter') { e.preventDefault(); resetGame(); }
    return;
  }

  // Overlay is showing (tab-away or initial) — any key dismisses it without typing
  if ($bodyArea.classList.contains('idle')) {
    e.preventDefault();
    $bodyArea.classList.remove('idle');
    return;
  }

  if (e.key.length > 1 && e.key !== 'Backspace') return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === ' ' || e.key === 'Enter') e.preventDefault();

  if (GameState.state === 'idle') {
    if (e.key === 'Backspace') return;
    startGame();
    if (e.key === ' ' || e.key === 'Enter') return;
  }

  const wordEl = getWordEl(GameState.wordIndex);
  if (!wordEl) return;
  const word = GameState.words[GameState.wordIndex];

  // ── Backspace ──────────────────────────────────────────────────────────────
  if (e.key === 'Backspace') {
    if (GameState.charIndex === 0) {
      // Step back to the previous word
      if (GameState.wordIndex === 0) return;
      GameState.wordIndex--;

      const prevWordEl = getWordEl(GameState.wordIndex);
      prevWordEl.classList.remove('word-error', 'cursor-after');

      // Drop any extra chars that were appended
      prevWordEl.querySelectorAll('.char.extra').forEach(el => el.remove());

      // Un-miss skipped chars and find the last actually-typed position
      const origChars = Array.from(prevWordEl.querySelectorAll('.char'));
      let lastTyped = 0;
      for (let i = 0; i < origChars.length; i++) {
        if (origChars[i].classList.contains('missed')) {
          origChars[i].classList.remove('missed');
        } else if (origChars[i].classList.contains('correct') || origChars[i].classList.contains('incorrect')) {
          lastTyped = i + 1;
        }
      }
      GameState.charIndex = lastTyped;
      moveCursor();
      updateSubject();
      return;
    }

    const prevIndex = GameState.charIndex - 1;
    // querySelectorAll returns in DOM order: original chars first, extras appended after
    const allChars = Array.from(wordEl.querySelectorAll('.char'));
    const span = allChars[prevIndex];

    if (span) {
      if (span.classList.contains('extra')) {
        span.remove(); // remove extra char from DOM entirely
      } else {
        if (span.classList.contains('correct')) GameState.correctChars--;
        span.classList.remove('correct', 'incorrect', 'missed');
      }
      GameState.totalChars--;
    }

    GameState.charIndex--;
    moveCursor();
    updateSubject();
    return;
  }

  // ── Space — commit word, advance to next ───────────────────────────────────
  if (e.key === ' ') {
    // Mark any untyped original chars as missed
    const origChars = Array.from(wordEl.querySelectorAll('.char:not(.extra)'));
    for (let i = GameState.charIndex; i < origChars.length; i++) {
      origChars[i].classList.add('missed');
    }

    const hasError = wordEl.querySelector('.incorrect, .missed, .extra') !== null;
    if (hasError) wordEl.classList.add('word-error');
    wordEl.classList.remove('cursor-after');

    // Space itself is a typed character (matches MonkeyType WPM formula)
    GameState.correctChars++;
    GameState.totalChars++;

    // Passage mode: space on the last word ends the game
    if (GameState.mode === 'passage' && GameState.wordIndex === GameState.words.length - 1) {
      endGame();
      return;
    }

    GameState.wordIndex++;
    GameState.charIndex = 0;

    // Race mode: keep appending words so the text never runs out
    if (GameState.mode === 'race' && GameState.wordIndex >= GameState.words.length - 5) {
      appendMoreWords();
    }

    moveCursor();
    updateSubject();
    return;
  }

  // ── Regular character ──────────────────────────────────────────────────────
  GameState.totalChars++;

  if (GameState.charIndex < word.length) {
    // Normal position within word
    const origChars = Array.from(wordEl.querySelectorAll('.char:not(.extra)'));
    const span = origChars[GameState.charIndex];
    if (!span) return;

    if (e.key === word[GameState.charIndex]) {
      span.classList.add('correct');
      GameState.correctChars++;
    } else {
      span.classList.add('incorrect');
    }
    span.classList.remove('missed');
  } else {
    // Past end of word — append a red extra-char span
    const extraSpan = document.createElement('span');
    extraSpan.className = 'char extra incorrect';
    extraSpan.textContent = e.key;
    wordEl.classList.remove('cursor-after');
    wordEl.appendChild(extraSpan);
  }

  GameState.charIndex++;

  // Passage mode: end as soon as the last char of the last word is typed
  if (GameState.mode === 'passage' &&
      GameState.wordIndex === GameState.words.length - 1 &&
      GameState.charIndex >= word.length) {
    endGame();
    return;
  }

  moveCursor();
  updateSubject();
}

// ── Cc dropdown ──────────────────────────────────────────────────────────────

function openDropdown() {
  $ccDropdown.classList.remove('hidden');
  $ccField.setAttribute('aria-expanded', 'true');
  $ccField.focus();
}

function closeDropdown() {
  $ccDropdown.classList.add('hidden');
  $ccField.setAttribute('aria-expanded', 'false');
}

function setActiveOption(btn) {
  $ccDropdown.querySelectorAll('.cc-option').forEach(o => o.classList.remove('active'));
  btn.classList.add('active');
  const textEl = $ccTag.querySelector('.cc-tag-text');
  if (textEl) textEl.textContent = btn.dataset.label;
}

// ── Event listeners ──────────────────────────────────────────────────────────

function initEventListeners() {
  document.addEventListener('keydown', handleKeypress);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && GameState.state !== 'finished') {
      $bodyArea.classList.add('idle');
    }
  });

  $bodyArea.addEventListener('click', () => {
    $bodyArea.classList.remove('idle');
    closeDropdown();
  });

  $ccField.addEventListener('click', e => {
    e.stopPropagation();
    if ($ccDropdown.classList.contains('hidden')) {
      openDropdown();
    } else {
      closeDropdown();
    }
  });

  $ccField.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDropdown();
  });

  $ccDropdown.addEventListener('click', e => {
    const btn = e.target.closest('.cc-option');
    if (!btn) return;
    e.stopPropagation();

    setActiveOption(btn);

    if (btn.dataset.mode === 'race') {
      GameState.mode = 'race';
      GameState.duration = parseInt(btn.dataset.duration, 10);
    } else {
      GameState.mode = 'passage';
      GameState.passageLength = btn.dataset.length;
    }

    closeDropdown();
    resetGame();
  });

  document.addEventListener('click', e => {
    if (!document.getElementById('ccRow').contains(e.target)) {
      closeDropdown();
    }
    const fontWrapper = document.getElementById('obFontWrapper');
    const fontMenu    = document.getElementById('obFontMenu');
    if (fontWrapper && fontMenu && !fontWrapper.contains(e.target)) {
      fontMenu.classList.add('hidden');
    }
  });

  // Ribbon font dropdown
  const $obFontDropdown = document.getElementById('obFontDropdown');
  const $obFontMenu     = document.getElementById('obFontMenu');
  if ($obFontDropdown && $obFontMenu) {
    $obFontDropdown.addEventListener('click', e => {
      e.stopPropagation();
      $obFontMenu.classList.toggle('hidden');
    });
    $obFontMenu.addEventListener('click', e => {
      const opt = e.target.closest('.ob-rfont-option');
      if (!opt) return;
      GameState.textStyle = opt.dataset.style;
      const label = document.getElementById('obFontLabel');
      if (label) label.textContent = opt.textContent.trim();
      $obFontMenu.querySelectorAll('.ob-rfont-option').forEach(o => o.classList.remove('ob-rfont-option--active'));
      opt.classList.add('ob-rfont-option--active');
      $obFontMenu.classList.add('hidden');
      resetGame();
    });
  }

  // Ribbon font size input + arrow buttons
  const $obFontSizeInput = document.getElementById('obFontSizeInput');
  if ($obFontSizeInput) {
    const applySize = size => {
      if (size >= 10 && size <= 28) $textDisplay.style.fontSize = (size + 5) + 'px';
    };
    $obFontSizeInput.addEventListener('input', e => applySize(parseInt(e.target.value, 10)));
    document.getElementById('obFontSizeUp')?.addEventListener('click', () => {
      const s = Math.min(28, parseInt($obFontSizeInput.value, 10) + 1);
      $obFontSizeInput.value = s; applySize(s);
    });
    document.getElementById('obFontSizeDown')?.addEventListener('click', () => {
      const s = Math.max(10, parseInt($obFontSizeInput.value, 10) - 1);
      $obFontSizeInput.value = s; applySize(s);
    });
  }

  document.getElementById('btnDiscard').addEventListener('click', resetGame);
  document.getElementById('btnClose').addEventListener('click', resetGame);

  $btnSend.addEventListener('click', () => {
    if (GameState.state === 'finished') resetGame();
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Load all word pools before first render; fallbacks above handle fetch failures
  await Promise.all([
    fetch('./words/MonkeyEnglish.json').then(r => r.json()).then(d => { if (d.words?.length)    monkeyWordPool    = d.words;    }).catch(() => {}),
    fetch('./words/CasualEnglish.json').then(r => r.json()).then(d => { if (d.words?.length)    casualWordPool    = d.words;    }).catch(() => {}),
    fetch('./words/corporateEnglish.json').then(r => r.json()).then(d => {
      if (d.short?.length)  corporatePassages.short  = d.short;
      if (d.medium?.length) corporatePassages.medium = d.medium;
      if (d.long?.length)   corporatePassages.long   = d.long;
    }).catch(() => {}),
  ]);

  $gameCaret = document.createElement('div');
  $gameCaret.className = 'game-caret';
  $textDisplay.appendChild($gameCaret);

  initEventListeners();
  const defaultOption = $ccDropdown.querySelector('[data-mode="race"][data-duration="15"]');
  if (defaultOption) defaultOption.classList.add('active');
  resetGame();
});
