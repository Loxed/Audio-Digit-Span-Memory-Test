import { TEST_MODES } from './config.js';
import { state, getExpectedSequence } from './state.js';
import { getMissingDigits, getVoiceLabel } from './audio.js';

export const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// Screen management
// ---------------------------------------------------------------------------

export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const next = $(`screen-${name}`);
  if (next) next.classList.add('active');
  state.phase = name;
}

// ---------------------------------------------------------------------------
// Welcome screen helpers
// ---------------------------------------------------------------------------

export function updateModeSelector() {
  const desc = $('mode-description');
  document.querySelectorAll('#mode-selector [data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === state.testMode);
  });
  if (desc) desc.textContent = TEST_MODES[state.testMode]?.description ?? '';
}

export function updateAudioConfigStatus() {
  const el = $('audio-config-status');
  if (!el) return;
  const missing = getMissingDigits(state.voice);
  if (missing.length === 0) {
    el.textContent = '';
    el.className = 'setting-note';
    return;
  }
  el.textContent = `Pack audio incomplet pour ${getVoiceLabel(state.voice)}. Fichiers manquants : ${missing.join(', ')}.`;
  el.className = 'setting-note warning';
}

export function setAudioConfigWarning(message) {
  const el = $('audio-config-status');
  if (!el) return;
  el.textContent = message;
  el.className = 'setting-note warning';
}

// ---------------------------------------------------------------------------
// Display screen helpers
// ---------------------------------------------------------------------------

export function setAudioWarning(message) {
  state.audioWarning = message;
  const el = $('audio-warning');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('visible', Boolean(message));
}

export function updateDisplayMode() {
  const container  = $('digit-container');
  const placeholder = $('display-placeholder');
  if (container)   container.classList.toggle('is-hidden', !state.debugVisualMode);
  if (placeholder) placeholder.textContent = state.debugVisualMode ? 'Lecture audio + affichage debug' : 'Lecture audio en cours';
  syncPlaybackDigit();
}

export function updateDisplayMeta() {
  const el = $('display-level');
  if (el) el.textContent = 'Écoutez la séquence';
  updateDisplayMode();
}

export function syncPlaybackDigit() {
  const el = $('digit-display');
  if (!el) return;
  const digit = state.sequence[state.displayIndex];
  el.textContent = state.phase === 'display' && state.debugVisualMode && Number.isInteger(digit) ? digit : '';
}

export function renderDots() {
  const container = $('progress-dots');
  container.innerHTML = '';
  state.sequence.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.id = `dot-${i}`;
    container.appendChild(dot);
  });
}

export function updateDots(activeIndex) {
  document.querySelectorAll('.dot').forEach((dot, i) => {
    dot.className = `dot${i < activeIndex ? ' shown' : i === activeIndex ? ' current' : ''}`;
  });
}

// ---------------------------------------------------------------------------
// Input screen helpers
// ---------------------------------------------------------------------------

export function getInputPromptText() {
  return state.testMode === 'ordering'
    ? 'Entrez les chiffres entendus du plus petit au plus grand, puis validez.'
    : 'Retapez la séquence entendue, puis validez.';
}

export function renderAnswer() {
  const container = $('answer-display');
  container.innerHTML = '';
  for (let i = 0; i < state.level; i++) {
    const slot = document.createElement('span');
    const has  = i < state.answer.length;
    slot.className = `answer-slot${has ? ' filled' : ''}`;
    slot.textContent = has ? state.answer[i] : '';
    container.appendChild(slot);
  }
}

export function updateSubmitButton() {
  const btn = $('btn-submit');
  if (btn) btn.disabled = state.answer.length !== state.level;
}

// ---------------------------------------------------------------------------
// Gameover screen helpers
// ---------------------------------------------------------------------------

export function setSaveStatus(message, tone = '') {
  const el = $('save-status');
  if (!el) return;
  el.textContent = message;
  el.className = `save-status${tone ? ` ${tone}` : ''}`;
}