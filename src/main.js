// ── State ────────────────────────────────────────────────────────────────────
const state = {
  inputMode: 'grid',     // 'grid' | 'keyboard'
  phase: 'welcome',      // welcome | countdown | display | input | feedback | gameover
  sequence: [],
  answer: [],
  level: 3,              // current digit count
  round: 0,              // rounds played
  lives: 2,              // lives remaining (2 strikes per level, or configure below)
  maxLevel: 0,           // best level reached
  totalCorrect: 0,
  displayIndex: 0,       // which digit we're currently showing
  displayTimer: null,
};

const DIGIT_SHOW_MS   = 900;   // how long digit is visible
const DIGIT_BLANK_MS  = 200;   // blank between digits
const FEEDBACK_MS     = 1400;  // how long feedback screen shows

// ── DOM helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = {};

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(`screen-${name}`);
  if (el) el.classList.add('active');
  state.phase = name;
}

function updateTopbar() {
  $('tb-level').textContent = state.level;
  $('tb-best').textContent  = state.maxLevel || '—';
  $('tb-lives').textContent = '●'.repeat(state.lives) + '○'.repeat(Math.max(0, 2 - state.lives));
}

// ── Sequence generation ──────────────────────────────────────────────────────
function generateSequence(len) {
  const seq = [];
  let last = -1;
  for (let i = 0; i < len; i++) {
    let d;
    do { d = Math.floor(Math.random() * 10); } while (d === last);
    seq.push(d);
    last = d;
  }
  return seq;
}

// ── Welcome screen ────────────────────────────────────────────────────────────
function initWelcome() {
  showScreen('welcome');
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === state.inputMode);
  });
}

// ── Countdown ────────────────────────────────────────────────────────────────
function startCountdown(cb) {
  showScreen('countdown');
  const el = $('countdown-num');
  let count = 3;
  el.textContent = count;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';

  const tick = () => {
    count--;
    if (count <= 0) {
      cb();
      return;
    }
    el.textContent = count;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    setTimeout(tick, 950);
  };
  setTimeout(tick, 950);
}

// ── Display phase ────────────────────────────────────────────────────────────
function startDisplay() {
  state.sequence = generateSequence(state.level);
  state.answer   = [];
  state.displayIndex = 0;

  showScreen('display');
  $('display-level').textContent = `Level ${state.level} · ${state.level} digits`;
  renderDots();
  showNextDigit();
}

function renderDots() {
  const container = $('progress-dots');
  container.innerHTML = '';
  for (let i = 0; i < state.sequence.length; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.id = `dot-${i}`;
    container.appendChild(dot);
  }
}

function showNextDigit() {
  const idx = state.displayIndex;
  const digit = state.sequence[idx];
  const el    = $('digit-display');
  const dot   = $(`dot-${idx}`);

  // mark current dot
  document.querySelectorAll('.dot').forEach((d, i) => {
    d.className = 'dot' + (i < idx ? ' shown' : i === idx ? ' current' : '');
  });

  el.textContent = digit;
  el.classList.remove('visible');
  void el.offsetWidth;
  el.classList.add('visible');

  setTimeout(() => {
    el.classList.remove('visible');
    if (dot) dot.className = 'dot shown';

    setTimeout(() => {
      state.displayIndex++;
      if (state.displayIndex < state.sequence.length) {
        showNextDigit();
      } else {
        setTimeout(() => startInput(), DIGIT_BLANK_MS);
      }
    }, DIGIT_BLANK_MS);
  }, DIGIT_SHOW_MS);
}

// ── Input phase ───────────────────────────────────────────────────────────────
function startInput() {
  showScreen('input');
  renderAnswer();

  // Show/hide grid vs keyboard hint
  $('num-grid').style.display    = state.inputMode === 'grid' ? 'grid' : 'none';
  $('grid-actions').style.display = state.inputMode === 'grid' ? 'flex' : 'none';
  $('keyboard-hint').style.display = state.inputMode === 'keyboard' ? 'block' : 'none';

  updateSubmitBtn();
}

function renderAnswer() {
  const container = $('answer-display');
  container.innerHTML = '';
  state.answer.forEach(d => {
    const span = document.createElement('span');
    span.className = 'answer-digit';
    span.textContent = d;
    container.appendChild(span);
  });
  const cursor = document.createElement('div');
  cursor.className = 'answer-cursor';
  container.appendChild(cursor);
}

function inputDigit(d) {
  if (state.answer.length >= state.level) return;
  state.answer.push(d);
  renderAnswer();
  updateSubmitBtn();
  if (state.answer.length === state.level) {
    // auto-submit after brief pause
    setTimeout(() => submitAnswer(), 300);
  }
}

function deleteDigit() {
  state.answer.pop();
  renderAnswer();
  updateSubmitBtn();
}

function updateSubmitBtn() {
  const btn = $('btn-submit');
  if (btn) btn.disabled = state.answer.length === 0;
}

function submitAnswer() {
  if (state.phase !== 'input') return;
  const correct = state.answer.join('') === state.sequence.join('');
  showFeedback(correct);
}

// ── Feedback ──────────────────────────────────────────────────────────────────
function showFeedback(correct) {
  showScreen('feedback');

  $('feedback-result').textContent = correct ? 'Correct' : 'Wrong';
  $('feedback-result').className = `feedback-result ${correct ? 'correct' : 'wrong'}`;
  $('feedback-icon').textContent = correct ? '✓' : '✗';

  // Show sequence with answer comparison
  const seqEl = $('feedback-sequence');
  if (correct) {
    seqEl.innerHTML = state.sequence.map(d => `<span class="highlight">${d}</span>`).join(' ');
  } else {
    seqEl.innerHTML = state.sequence.map((d, i) => {
      const ans = state.answer[i];
      const match = String(ans) === String(d);
      return match
        ? `<span class="highlight">${d}</span>`
        : `<span style="color:var(--red)">${d}</span>`;
    }).join(' ');
  }

  // flash body
  document.body.classList.remove('flash-correct', 'flash-wrong');
  void document.body.offsetWidth;
  document.body.classList.add(correct ? 'flash-correct' : 'flash-wrong');

  setTimeout(() => {
    document.body.classList.remove('flash-correct', 'flash-wrong');
    if (correct) {
      state.totalCorrect++;
      state.level++;
      if (state.level > state.maxLevel) state.maxLevel = state.level;
      updateTopbar();
      startDisplay();
    } else {
      state.lives--;
      updateTopbar();
      if (state.lives <= 0) {
        showGameOver();
      } else {
        // retry same level
        startDisplay();
      }
    }
  }, FEEDBACK_MS);
}

// ── Game Over ─────────────────────────────────────────────────────────────────
function showGameOver() {
  showScreen('gameover');
  $('final-score').textContent  = state.level - 1;
  $('stat-rounds').textContent  = state.totalCorrect;
  $('stat-best').textContent    = state.maxLevel;
}

function restartGame() {
  state.level        = 3;
  state.lives        = 2;
  state.round        = 0;
  state.totalCorrect = 0;
  updateTopbar();
  startCountdown(() => startDisplay());
}

// ── Keyboard handler ──────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (state.phase !== 'input') return;
  if (e.key >= '0' && e.key <= '9') {
    inputDigit(parseInt(e.key));
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    deleteDigit();
  } else if (e.key === 'Enter') {
    submitAnswer();
  }
});

// ── Build DOM ─────────────────────────────────────────────────────────────────
function buildApp() {
  const app = $('app');
  app.innerHTML = `
    <!-- Top bar -->
    <div id="topbar">
      <span class="tb-logo">Digit Span</span>
      <div class="tb-stats">
        <span class="tb-stat">Level<span id="tb-level">—</span></span>
        <span class="tb-stat">Best<span id="tb-best">—</span></span>
        <span class="tb-stat">Lives<span id="tb-lives">——</span></span>
      </div>
    </div>

    <!-- WELCOME -->
    <div id="screen-welcome" class="screen">
      <div class="logo-mark">
        <svg viewBox="0 0 24 24"><rect x="4" y="4" width="5" height="5" rx="1"/><rect x="10" y="4" width="5" height="5" rx="1"/><rect x="16" y="4" width="5" height="5" rx="1"/><rect x="4" y="10" width="5" height="5" rx="1"/><rect x="16" y="10" width="5" height="5" rx="1"/><rect x="4" y="16" width="5" height="5" rx="1"/><rect x="10" y="16" width="5" height="5" rx="1"/><rect x="16" y="16" width="5" height="5" rx="1"/></svg>
      </div>
      <h1>Digit Span</h1>
      <p class="tagline">A sequence of numbers will appear one at a time. Memorize them in order, then type them back.</p>

      <div class="info-grid">
        <div class="info-card"><div class="label">Starting level</div><div class="value">3 digits</div></div>
        <div class="info-card"><div class="label">Display speed</div><div class="value">1 digit / sec</div></div>
        <div class="info-card"><div class="label">Lives</div><div class="value">2 mistakes</div></div>
        <div class="info-card"><div class="label">Avg. human span</div><div class="value">7 ± 2 digits</div></div>
      </div>

      <div class="mode-selector">
        <div class="mode-label">Input method</div>
        <div class="mode-tabs">
          <button class="mode-tab" data-mode="grid">
            <span class="tab-icon">#</span>Number Grid
          </button>
          <button class="mode-tab" data-mode="keyboard">
            <span class="tab-icon">⌨</span>Keyboard
          </button>
        </div>
      </div>

      <button class="btn-primary" id="btn-start">Start Test</button>
    </div>

    <!-- COUNTDOWN -->
    <div id="screen-countdown" class="screen">
      <div class="countdown-label">Get ready</div>
      <div class="countdown-num" id="countdown-num">3</div>
    </div>

    <!-- DISPLAY -->
    <div id="screen-display" class="screen">
      <div class="display-meta" id="display-level">Level 3 · 3 digits</div>
      <div class="digit-container">
        <div class="digit-display" id="digit-display"></div>
      </div>
      <div class="progress-dots" id="progress-dots"></div>
    </div>

    <!-- INPUT -->
    <div id="screen-input" class="screen">
      <div class="input-header">
        <div class="prompt">What was the sequence?</div>
        <div class="answer-display" id="answer-display"></div>
      </div>

      <div class="num-grid" id="num-grid">
        <button class="num-btn" data-digit="7">7</button>
        <button class="num-btn" data-digit="8">8</button>
        <button class="num-btn" data-digit="9">9</button>
        <button class="num-btn" data-digit="4">4</button>
        <button class="num-btn" data-digit="5">5</button>
        <button class="num-btn" data-digit="6">6</button>
        <button class="num-btn" data-digit="1">1</button>
        <button class="num-btn" data-digit="2">2</button>
        <button class="num-btn" data-digit="3">3</button>
        <button class="num-btn zero-btn" data-digit="0">0</button>
      </div>

      <div class="grid-actions" id="grid-actions">
        <button class="btn-action btn-del" id="btn-del">⌫ Delete</button>
        <button class="btn-action btn-submit" id="btn-submit" disabled>Submit →</button>
      </div>

      <div class="keyboard-hint" id="keyboard-hint" style="display:none">
        Type digits · <kbd class="kbd">⌫</kbd> to delete · <kbd class="kbd">↵</kbd> to submit
      </div>
    </div>

    <!-- FEEDBACK -->
    <div id="screen-feedback" class="screen">
      <div class="feedback-icon" id="feedback-icon">✓</div>
      <div class="feedback-result correct" id="feedback-result">Correct</div>
      <div class="feedback-sequence" id="feedback-sequence"></div>
    </div>

    <!-- GAME OVER -->
    <div id="screen-gameover" class="screen">
      <div class="gameover-title">Digit span</div>
      <div class="score-display" id="final-score">0</div>
      <div class="score-unit">digits</div>

      <div class="stats-row">
        <div class="stat-box">
          <div class="s-label">Rounds won</div>
          <div class="s-value" id="stat-rounds">0</div>
        </div>
        <div class="stat-box">
          <div class="s-label">Best level</div>
          <div class="s-value" id="stat-best">0</div>
        </div>
      </div>

      <div class="gameover-btns">
        <button class="btn-ghost" id="btn-menu" style="flex:1">Menu</button>
        <button class="btn-primary" id="btn-retry" style="flex:2">Try Again</button>
      </div>
    </div>
  `;

  // Wire events
  $('btn-start').addEventListener('click', () => {
    startCountdown(() => startDisplay());
  });

  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.inputMode = tab.dataset.mode;
      document.querySelectorAll('.mode-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.mode === state.inputMode)
      );
    });
  });

  document.querySelectorAll('.num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.phase === 'input') inputDigit(parseInt(btn.dataset.digit));
    });
  });

  $('btn-del').addEventListener('click', deleteDigit);
  $('btn-submit').addEventListener('click', submitAnswer);
  $('btn-retry').addEventListener('click', restartGame);
  $('btn-menu').addEventListener('click', () => {
    state.level = 3;
    state.lives = 2;
    state.totalCorrect = 0;
    state.maxLevel = 0;
    updateTopbar();
    initWelcome();
  });

  updateTopbar();
  initWelcome();
}

buildApp();
