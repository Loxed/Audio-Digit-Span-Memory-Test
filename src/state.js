import { ACTIVE_VOICE, DEBUG_VISUAL_MODE, LIVES_PER_GAME } from './config.js';

export const state = {
  phase: 'welcome',
  playerName: '',
  sequence: [],
  answer: [],
  roundHistory: [],
  testMode: 'forward',
  level: 3,
  lives: LIVES_PER_GAME,
  winsAtCurrentLevel: 0,
  maxLevel: 2,
  totalCorrect: 0,
  displayIndex: 0,
  pendingTimeouts: [],
  voice: ACTIVE_VOICE,
  debugVisualMode: DEBUG_VISUAL_MODE,
  activeAudio: null,
  audioWarning: '',
};

export function queueTimeout(callback, ms) {
  const id = window.setTimeout(() => {
    state.pendingTimeouts = state.pendingTimeouts.filter(t => t !== id);
    callback();
  }, ms);
  state.pendingTimeouts.push(id);
  return id;
}

export function clearPendingTimeouts() {
  state.pendingTimeouts.forEach(id => window.clearTimeout(id));
  state.pendingTimeouts = [];
}

export function getScore() {
  return state.maxLevel;
}

export function getExpectedSequence(sequence = state.sequence) {
  return state.testMode === 'ordering'
    ? [...sequence].sort((a, b) => a - b)
    : [...sequence];
}