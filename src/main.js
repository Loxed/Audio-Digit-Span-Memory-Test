import { TEST_MODES } from './config.js';
import { state } from './state.js';
import { updateModeSelector, updateAudioConfigStatus, updateDisplayMode, $ } from './ui.js';
import { initWelcome, startNewGame, inputDigit, deleteDigit, submitAnswer, resetGameState } from './game.js';

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function buildApp() {
  document.getElementById('app').innerHTML = `
    <div id="topbar">
      <span class="tb-logo">Digit Span Memory Test</span>
    </div>

    <!-- WELCOME -->
    <div id="screen-welcome" class="screen">
      <h1>Digit Span Memory Test</h1>
      <p class="tagline">L'expérience est auditive. Un chiffre est dit chaque seconde. Vous devez écrire la séquence que vous avez entendue.</p>

      <div class="settings-panel">
        <div class="setting-card">
          <div class="setting-label">Mode de test</div>
          <div class="option-tabs" id="mode-selector">
            <button class="option-tab active" type="button" data-mode="forward">${TEST_MODES.forward.label}</button>
            <button class="option-tab"        type="button" data-mode="ordering">${TEST_MODES.ordering.label}</button>
          </div>
          <div class="setting-help" id="mode-description">${TEST_MODES.forward.description}</div>
        </div>

        <div class="setting-card">
          <label class="setting-label" for="player-name-input">Nom du joueur</label>
          <input class="text-input" id="player-name-input" type="text" maxlength="60" placeholder="Entrez votre nom" autocomplete="off" />
          <div class="setting-note" id="player-name-error"></div>
        </div>
      </div>

      <div class="setting-note" id="audio-config-status"></div>

      <p class="tagline" style="font-size:14px">Vous pouvez utiliser votre clavier ou le clavier virtuel pour entrer les chiffres.</p>
      <button class="btn-primary" id="btn-start">Commencer</button>
    </div>

    <!-- COUNTDOWN -->
    <div id="screen-countdown" class="screen">
      <div class="countdown-label">Préparez-vous</div>
      <div class="countdown-num" id="countdown-num">3</div>
    </div>

    <!-- DISPLAY -->
    <div id="screen-display" class="screen">
      <div class="display-meta" id="display-level">Écoutez la séquence</div>
      <div class="display-placeholder" id="display-placeholder">Lecture audio en cours</div>
      <div class="digit-container is-hidden" id="digit-container">
        <div class="digit-display" id="digit-display"></div>
      </div>
      <div class="audio-warning" id="audio-warning" aria-live="polite"></div>
      <div class="progress-dots" id="progress-dots"></div>
    </div>

    <!-- INPUT -->
    <div id="screen-input" class="screen">
      <div class="input-header">
        <div class="prompt" id="input-prompt">Retapez la séquence entendue, puis validez.</div>
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

      <div class="grid-actions">
        <button class="btn-action btn-del" id="btn-del">Effacer</button>
        <button class="btn-action btn-submit" id="btn-submit" disabled>Valider</button>
      </div>

      <div class="keyboard-hint">
        Clavier ou boutons numériques, puis <kbd class="kbd">Entrée</kbd> ou <kbd class="kbd">Valider</kbd>.
      </div>
    </div>

    <!-- TRANSITION -->
    <div id="screen-transition" class="screen">
      <div class="transition-title"   id="transition-title">Réponse enregistrée</div>
      <div class="transition-message" id="transition-message">Prochaine séquence...</div>
    </div>

    <!-- GAMEOVER -->
    <div id="screen-gameover" class="screen">
      <div class="gameover-title">Résultat final</div>
      <div class="gameover-player" id="gameover-player"></div>
      <div class="score-display" id="final-score">0</div>
      <div class="score-unit">chiffres</div>

      <div class="stats-row">
        <div class="stat-box">
          <div class="s-label">Séries réussies</div>
          <div class="s-value" id="stat-rounds">0</div>
        </div>
      </div>

      <div class="save-card">
        <div class="save-status" id="save-status" aria-live="polite"></div>
      </div>

      <div class="gameover-btns">
      // <button class="btn-ghost"  id="btn-retry" style="flex:1">Recommencer</button>
      <button class="btn-primary"    id="btn-menu"  style="flex:2">Menu</button>
      </div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------

  // Welcome: name validation helper
  function getPlayerName() {
    return ($('player-name-input')?.value ?? '').trim();
  }

  $('btn-start').addEventListener('click', () => {
    const name = getPlayerName();
    if (!name) {
      const err = $('player-name-error');
      if (err) { err.textContent = 'Veuillez entrer votre nom avant de commencer.'; err.className = 'setting-note warning'; }
      $('player-name-input')?.focus();
      return;
    }
    const err = $('player-name-error');
    if (err) err.textContent = '';
    state.playerName = name;
    startNewGame();
  });

  $('player-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('btn-start').click(); }
  });

  document.querySelectorAll('#mode-selector [data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.testMode = btn.dataset.mode;
      updateModeSelector();
    });
  });

  // Input screen
  document.querySelectorAll('.num-btn').forEach(btn => {
    btn.addEventListener('click', () => inputDigit(Number(btn.dataset.digit)));
  });
  $('btn-del').addEventListener('click', deleteDigit);
  $('btn-submit').addEventListener('click', submitAnswer);

  // Gameover
  $('btn-retry').addEventListener('click', () => {
    state.playerName = state.playerName; // keep name
    startNewGame();
  });
  $('btn-menu').addEventListener('click', () => {
    resetGameState();
    // Pre-fill name field so user doesn't have to retype
    const nameInput = $('player-name-input');
    if (nameInput && state.playerName) nameInput.value = state.playerName;
    initWelcome();
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (state.phase !== 'input') return;
    if (e.key >= '0' && e.key <= '9') { e.preventDefault(); inputDigit(Number(e.key)); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteDigit(); return; }
    if (e.key === 'Enter') { e.preventDefault(); submitAnswer(); }
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  updateModeSelector();
  updateAudioConfigStatus();
  updateDisplayMode();
  initWelcome();

  // Auto-focus name field on load
  setTimeout(() => $('player-name-input')?.focus(), 80);
}

buildApp();