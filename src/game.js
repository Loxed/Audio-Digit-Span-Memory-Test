import { DIGIT_STEP_MS, LIVES_PER_GAME, REQUIRED_CORRECT_ROUNDS_PER_LEVEL, ROUND_BREAK_MS } from './config.js';
import { state, clearPendingTimeouts, queueTimeout, getScore, getExpectedSequence } from './state.js';
import { stopActiveAudio, ensureVoiceAudioReady, playDigitAudio } from './audio.js';
import {
  showScreen,
  updateModeSelector,
  updateAudioConfigStatus,
  updateDisplayMode,
  setAudioConfigWarning,
  setAudioWarning,
  updateDisplayMeta,
  renderDots,
  updateDots,
  syncPlaybackDigit,
  getInputPromptText,
  renderAnswer,
  updateSubmitButton,
  setSaveStatus,
  $,
} from './ui.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resetTransientFlow() {
  clearPendingTimeouts();
  stopActiveAudio();
  setAudioWarning('');
}

export function generateSequence(length) {
  const seq = [];
  let last = -1;
  for (let i = 0; i < length; i++) {
    let d;
    do { d = Math.floor(Math.random() * 10); } while (d === last);
    seq.push(d);
    last = d;
  }
  return seq;
}

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

export function resetGameState() {
  resetTransientFlow();
  state.sequence          = [];
  state.answer            = [];
  state.roundHistory      = [];
  state.level             = 3;
  state.lives             = LIVES_PER_GAME;
  state.winsAtCurrentLevel = 0;
  state.maxLevel          = 2;
  state.totalCorrect      = 0;
  state.displayIndex      = 0;
}

// ---------------------------------------------------------------------------
// Welcome / init
// ---------------------------------------------------------------------------

export function initWelcome() {
  resetTransientFlow();
  showScreen('welcome');
  updateModeSelector();
  updateAudioConfigStatus();
  updateDisplayMode();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

export async function startNewGame() {
  // playerName must be set before calling this
  resetGameState();

  try {
    await primeAudioPlayback();
  } catch {
    initWelcome();
    return;
  }

  startCountdown(() => startDisplay());
}

async function primeAudioPlayback() {
  try {
    await ensureVoiceAudioReady(state.voice);
    updateAudioConfigStatus();
  } catch (err) {
    setAudioConfigWarning(err.message || 'Impossible de préparer les fichiers audio.');
    throw err;
  }
}

function startCountdown(callback) {
  resetTransientFlow();
  showScreen('countdown');

  const el  = $('countdown-num');
  let count = 3;
  el.textContent = count;

  const tick = () => {
    count--;
    if (count <= 0) { callback(); return; }
    el.textContent = count;
    queueTimeout(tick, 1000);
  };

  queueTimeout(tick, 1000);
}

function startDisplay() {
  resetTransientFlow();

  state.sequence     = generateSequence(state.level);
  state.answer       = [];
  state.displayIndex = 0;

  showScreen('display');
  updateDisplayMeta();
  renderDots();
  syncPlaybackDigit();
  showNextDigit();
}

function showNextDigit() {
  const idx = state.displayIndex;
  if (idx >= state.sequence.length) { startInput(); return; }

  updateDots(idx);
  syncPlaybackDigit();
  playDigitAudio(state.sequence[idx]);

  queueTimeout(() => {
    const dot = $(`dot-${idx}`);
    if (dot) dot.className = 'dot shown';

    state.displayIndex++;
    if (state.displayIndex < state.sequence.length) {
      showNextDigit();
      return;
    }

    syncPlaybackDigit();
    startInput();
  }, DIGIT_STEP_MS);
}

function startInput() {
  resetTransientFlow();
  showScreen('input');
  $('input-prompt').textContent = getInputPromptText();
  renderAnswer();
  updateSubmitButton();
}

// ---------------------------------------------------------------------------
// Input actions
// ---------------------------------------------------------------------------

export function inputDigit(digit) {
  if (state.phase !== 'input' || state.answer.length >= state.level) return;
  state.answer.push(digit);
  renderAnswer();
  updateSubmitButton();
}

export function deleteDigit() {
  if (state.phase !== 'input' || state.answer.length === 0) return;
  state.answer.pop();
  renderAnswer();
  updateSubmitButton();
}

export function submitAnswer() {
  if (state.phase !== 'input' || state.answer.length !== state.level) return;
  const isCorrect = state.answer.join('') === getExpectedSequence().join('');
  showTransition(isCorrect);
}

// ---------------------------------------------------------------------------
// Transition & scoring
// ---------------------------------------------------------------------------

function recordRoundResult(isCorrect) {
  const roundResult = {
    round:          state.roundHistory.length + 1,
    question:       state.sequence.join(''),
    answer:         state.answer.join(''),
    correct:        isCorrect,
  };

  if (state.testMode === 'ordering') {
    roundResult.expectedAnswer = getExpectedSequence().join('');
  }

  state.roundHistory.push(roundResult);
}

function showTransition(isCorrect) {
  resetTransientFlow();
  showScreen('transition');
  recordRoundResult(isCorrect);

  const willEnd = !isCorrect && state.lives === 1;
  $('transition-title').textContent   = willEnd ? 'Fin de l\'épreuve' : 'Réponse enregistrée';
  $('transition-message').textContent = willEnd ? 'Calcul du score final...' : 'Prochaine séquence...';

  queueTimeout(() => {
    if (isCorrect) {
      state.totalCorrect++;
      state.maxLevel = Math.max(state.maxLevel, state.level);
      state.winsAtCurrentLevel++;
      if (state.winsAtCurrentLevel >= REQUIRED_CORRECT_ROUNDS_PER_LEVEL) {
        state.level++;
        state.winsAtCurrentLevel = 0;
      }
      startDisplay();
      return;
    }

    state.lives--;
    if (state.lives <= 0) { showGameOver(); return; }
    startDisplay();
  }, ROUND_BREAK_MS);
}

// ---------------------------------------------------------------------------
// Game over + auto-save
// ---------------------------------------------------------------------------

function showGameOver() {
  resetTransientFlow();
  showScreen('gameover');

  $('final-score').textContent  = getScore();
  $('stat-rounds').textContent  = state.totalCorrect;
  $('gameover-player').textContent = state.playerName || '—';

  setSaveStatus('Enregistrement en cours...', 'info');
  autoSaveScore();
}

function buildResultPayload() {
  return {
    name:           state.playerName,
    score:          getScore(),
    roundsWon:      state.totalCorrect,
    finalLevel:     state.level,
    testMode:       state.testMode,
    voice:          state.voice,
    debugVisualMode: state.debugVisualMode,
    savedAt:        new Date().toISOString(),
    rounds:         state.roundHistory.map(r => ({ ...r })),
  };
}

async function autoSaveScore() {
  try {
    const response = await fetch('/api/results', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(buildResultPayload()),
    });

    const text   = await response.text();
    const result = text ? JSON.parse(text) : {};

    if (!response.ok) throw new Error(result.error || 'Impossible d\'enregistrer le résultat.');

    const highScoreSuffix = Number.isFinite(result.highScore) ? ` High score : ${result.highScore}.` : '';
    setSaveStatus(`Résultat enregistré dans ${result.relativePath}.${highScoreSuffix}`, 'success');
  } catch (err) {
    if (err instanceof TypeError) {
      setSaveStatus('Sauvegarde indisponible. Lancez l\'application avec le serveur Vite pour écrire dans resultats/.', 'error');
      return;
    }
    setSaveStatus(err.message || 'Impossible d\'enregistrer le score.', 'error');
  }
}
