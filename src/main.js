const DIGIT_STEP_MS = 1000;
const ROUND_BREAK_MS = 1200;
const PREFERRED_VOICE_ORDER = ['thomas', 'amelie'];
const VOICE_LABELS = {
  thomas: 'Thomas',
  amelie: 'Amelie',
};

const rawAudioModules = import.meta.glob('../audio/*/chiffre_*.aiff', {
  eager: true,
  import: 'default',
});

const audioLibrary = buildAudioLibrary(rawAudioModules);
const voiceOptions = getVoiceOptions();
const decodedAudioBufferCache = new Map();
const decodedAudioPromiseCache = new Map();

let audioContext = null;

const state = {
  phase: 'welcome',
  sequence: [],
  answer: [],
  level: 3,
  lives: 2,
  maxLevel: 2,
  totalCorrect: 0,
  displayIndex: 0,
  pendingTimeouts: [],
  voice: voiceOptions[0] ?? 'thomas',
  debugVisualMode: false,
  activeAudio: null,
  audioWarning: '',
};

const $ = id => document.getElementById(id);

function buildAudioLibrary(modules) {
  const library = {};

  Object.entries(modules).forEach(([path, source]) => {
    const normalizedPath = path.replace(/\\/g, '/');
    const match = normalizedPath.match(/\/audio\/([^/]+)\/chiffre_(\d)\.aiff$/);
    if (!match) return;

    const voice = match[1];
    const digit = Number(match[2]);
    library[voice] ??= {};
    library[voice][digit] = source;
  });

  return library;
}

function getVoiceOptions() {
  const voices = Object.keys(audioLibrary);
  if (voices.length === 0) return [...PREFERRED_VOICE_ORDER];

  return voices.sort((left, right) => {
    const leftIndex = PREFERRED_VOICE_ORDER.indexOf(left);
    const rightIndex = PREFERRED_VOICE_ORDER.indexOf(right);

    if (leftIndex === -1 && rightIndex === -1) {
      return left.localeCompare(right);
    }

    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;

    return leftIndex - rightIndex;
  });
}

function getVoiceLabel(voice) {
  return VOICE_LABELS[voice] ?? `${voice.charAt(0).toUpperCase()}${voice.slice(1)}`;
}

function getMissingDigits(voice) {
  const missingDigits = [];

  for (let digit = 0; digit <= 9; digit += 1) {
    if (!audioLibrary[voice]?.[digit]) {
      missingDigits.push(digit);
    }
  }

  return missingDigits;
}

function getAudioCacheKey(voice, digit) {
  return `${voice}:${digit}`;
}

function queueTimeout(callback, ms) {
  const timeoutId = window.setTimeout(() => {
    state.pendingTimeouts = state.pendingTimeouts.filter(id => id !== timeoutId);
    callback();
  }, ms);

  state.pendingTimeouts.push(timeoutId);
  return timeoutId;
}

function clearPendingTimeouts() {
  state.pendingTimeouts.forEach(timeoutId => window.clearTimeout(timeoutId));
  state.pendingTimeouts = [];
}

function stopActiveAudio() {
  if (!state.activeAudio) return;

  try {
    state.activeAudio.onended = null;
    state.activeAudio.stop(0);
  } catch (error) {
    // Ignore stop errors from already-finished sources.
  }

  if (state.activeAudio.disconnect) {
    state.activeAudio.disconnect();
  }

  state.activeAudio = null;
}

function resetTransientFlow() {
  clearPendingTimeouts();
  stopActiveAudio();
  setAudioWarning('');
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  const nextScreen = $(`screen-${name}`);
  if (nextScreen) nextScreen.classList.add('active');
  state.phase = name;
}

function pluralizeDigits(count) {
  return `${count} chiffre${count > 1 ? 's' : ''}`;
}

function getScore() {
  return state.maxLevel;
}

function updateTopbar() {
  $('tb-level').textContent = state.level;
  $('tb-best').textContent = state.maxLevel > 2 ? state.maxLevel : '—';
  $('tb-lives').textContent = '●'.repeat(state.lives) + '○'.repeat(Math.max(0, 2 - state.lives));
}

function generateSequence(length) {
  const sequence = [];
  let lastDigit = -1;

  for (let index = 0; index < length; index += 1) {
    let digit;
    do {
      digit = Math.floor(Math.random() * 10);
    } while (digit === lastDigit);

    sequence.push(digit);
    lastDigit = digit;
  }

  return sequence;
}

function updateAudioConfigStatus() {
  const statusEl = $('audio-config-status');
  if (!statusEl) return;

  const missingDigits = getMissingDigits(state.voice);
  if (missingDigits.length === 0) {
    statusEl.textContent = `${getVoiceLabel(state.voice)} pret : 10 fichiers audio detectes.`;
    statusEl.className = 'setting-note success';
    return;
  }

  statusEl.textContent = `Pack ${getVoiceLabel(state.voice)} incomplet. Fichiers manquants : ${missingDigits.join(', ')}.`;
  statusEl.className = 'setting-note warning';
}

function setAudioConfigWarning(message) {
  const statusEl = $('audio-config-status');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = 'setting-note warning';
}

function renderVoiceSelector() {
  const voiceSelector = $('voice-selector');
  if (!voiceSelector) return;

  voiceSelector.innerHTML = '';

  voiceOptions.forEach(voice => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `option-tab${state.voice === voice ? ' active' : ''}`;
    button.dataset.voice = voice;
    button.textContent = getVoiceLabel(voice);
    button.addEventListener('click', () => {
      state.voice = voice;
      updateVoiceSelector();
      updateAudioConfigStatus();
      updateDisplayMeta();
    });
    voiceSelector.appendChild(button);
  });
}

function updateVoiceSelector() {
  document.querySelectorAll('.option-tab[data-voice]').forEach(button => {
    button.classList.toggle('active', button.dataset.voice === state.voice);
  });
}

function updateDisplayMode() {
  const digitContainer = $('digit-container');
  const displayPlaceholder = $('display-placeholder');

  if (digitContainer) {
    digitContainer.classList.toggle('is-hidden', !state.debugVisualMode);
  }

  if (displayPlaceholder) {
    displayPlaceholder.textContent = state.debugVisualMode
      ? `Lecture audio ${getVoiceLabel(state.voice)} + affichage debug`
      : `Lecture audio ${getVoiceLabel(state.voice)} en cours`;
  }

  syncPlaybackDigit();
}

function setAudioWarning(message) {
  state.audioWarning = message;

  const warningEl = $('audio-warning');
  if (!warningEl) return;

  warningEl.textContent = message;
  warningEl.classList.toggle('visible', Boolean(message));
}

function updateDisplayMeta() {
  const displayMeta = $('display-level');
  if (!displayMeta) return;

  displayMeta.textContent = `Niveau ${state.level} · ${getVoiceLabel(state.voice)} · ${pluralizeDigits(state.level)}`;
  updateDisplayMode();
}

function syncPlaybackDigit() {
  const displayEl = $('digit-display');
  if (!displayEl) return;

  const currentDigit = state.sequence[state.displayIndex];
  const shouldShowDigit =
    state.phase === 'display' &&
    state.debugVisualMode &&
    Number.isInteger(currentDigit);

  displayEl.textContent = shouldShowDigit ? currentDigit : '';
}

async function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio API indisponible dans ce navigateur.');
    }

    audioContext = new AudioContextClass();
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  return audioContext;
}

function readAscii(view, offset, length) {
  let output = '';

  for (let index = 0; index < length; index += 1) {
    output += String.fromCharCode(view.getUint8(offset + index));
  }

  return output;
}

function readExtendedFloat80(view, offset) {
  const exponentBits = view.getUint16(offset, false);
  const highMantissa = view.getUint32(offset + 2, false);
  const lowMantissa = view.getUint32(offset + 6, false);

  if (exponentBits === 0 && highMantissa === 0 && lowMantissa === 0) {
    return 0;
  }

  const sign = (exponentBits & 0x8000) !== 0 ? -1 : 1;
  const exponent = (exponentBits & 0x7fff) - 16383;
  const mantissa = highMantissa * 2 ** -31 + lowMantissa * 2 ** -63;

  return sign * mantissa * 2 ** exponent;
}

function readPcmSample(view, offset, bitsPerSample) {
  switch (bitsPerSample) {
    case 8:
      return view.getInt8(offset);
    case 16:
      return view.getInt16(offset, false);
    case 24: {
      const byte0 = view.getUint8(offset);
      const byte1 = view.getUint8(offset + 1);
      const byte2 = view.getUint8(offset + 2);
      let value = (byte0 << 16) | (byte1 << 8) | byte2;
      if (value & 0x800000) {
        value |= 0xff000000;
      }
      return value;
    }
    case 32:
      return view.getInt32(offset, false);
    default:
      throw new Error(`Taille d'echantillon AIFF non supportee : ${bitsPerSample} bits.`);
  }
}

function normalizePcmSample(sample, bitsPerSample) {
  const maxMagnitude = 2 ** (bitsPerSample - 1);
  return Math.max(-1, Math.min(1, sample / maxMagnitude));
}

function parseAiffBuffer(arrayBuffer) {
  const view = new DataView(arrayBuffer);

  if (readAscii(view, 0, 4) !== 'FORM') {
    throw new Error('Fichier audio invalide : en-tete FORM introuvable.');
  }

  const formType = readAscii(view, 8, 4);
  if (formType !== 'AIFF' && formType !== 'AIFC') {
    throw new Error(`Format audio non supporte : ${formType}.`);
  }

  let channelCount = 0;
  let frameCount = 0;
  let bitsPerSample = 0;
  let sampleRate = 0;
  let compressionType = 'NONE';
  let soundDataOffset = 0;
  let soundDataSize = 0;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, false);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'COMM') {
      channelCount = view.getUint16(chunkDataOffset, false);
      frameCount = view.getUint32(chunkDataOffset + 2, false);
      bitsPerSample = view.getUint16(chunkDataOffset + 6, false);
      sampleRate = readExtendedFloat80(view, chunkDataOffset + 8);

      if (formType === 'AIFC' && chunkSize >= 22) {
        compressionType = readAscii(view, chunkDataOffset + 18, 4);
      }
    }

    if (chunkId === 'SSND') {
      const audioDataOffset = view.getUint32(chunkDataOffset, false);
      soundDataOffset = chunkDataOffset + 8 + audioDataOffset;
      soundDataSize = Math.max(0, chunkSize - 8 - audioDataOffset);
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (compressionType !== 'NONE' && compressionType !== 'twos') {
    throw new Error(`Compression audio non supportee : ${compressionType}.`);
  }

  if (bitsPerSample % 8 !== 0 || bitsPerSample <= 0 || bitsPerSample > 32) {
    throw new Error(`Profondeur audio non supportee : ${bitsPerSample} bits.`);
  }

  if (!channelCount || !frameCount || !sampleRate || !soundDataOffset) {
    throw new Error('Le fichier AIFF est incomplet ou corrompu.');
  }

  const bytesPerSample = bitsPerSample / 8;
  const bytesPerFrame = bytesPerSample * channelCount;
  const availableFrameCount = Math.floor(soundDataSize / bytesPerFrame);
  const safeFrameCount = Math.min(frameCount, availableFrameCount);
  const channelData = Array.from({ length: channelCount }, () => new Float32Array(safeFrameCount));

  let sampleOffset = soundDataOffset;
  for (let frameIndex = 0; frameIndex < safeFrameCount; frameIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = readPcmSample(view, sampleOffset, bitsPerSample);
      channelData[channelIndex][frameIndex] = normalizePcmSample(sample, bitsPerSample);
      sampleOffset += bytesPerSample;
    }
  }

  return {
    channelData,
    channelCount,
    frameCount: safeFrameCount,
    sampleRate: Math.max(1, Math.round(sampleRate)),
  };
}

async function decodeDigitAudio(voice, digit) {
  const cacheKey = getAudioCacheKey(voice, digit);
  if (decodedAudioBufferCache.has(cacheKey)) {
    return decodedAudioBufferCache.get(cacheKey);
  }

  if (decodedAudioPromiseCache.has(cacheKey)) {
    return decodedAudioPromiseCache.get(cacheKey);
  }

  const decodePromise = (async () => {
    const source = audioLibrary[voice]?.[digit];
    if (!source) {
      throw new Error(`Audio introuvable : audio/${voice}/chiffre_${digit}.aiff`);
    }

    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Impossible de charger audio/${voice}/chiffre_${digit}.aiff`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const parsedAudio = parseAiffBuffer(arrayBuffer);
    const context = await ensureAudioContext();
    const audioBuffer = context.createBuffer(
      parsedAudio.channelCount,
      parsedAudio.frameCount,
      parsedAudio.sampleRate
    );

    parsedAudio.channelData.forEach((channel, index) => {
      audioBuffer.copyToChannel(channel, index);
    });

    decodedAudioBufferCache.set(cacheKey, audioBuffer);
    decodedAudioPromiseCache.delete(cacheKey);
    return audioBuffer;
  })().catch(error => {
    decodedAudioPromiseCache.delete(cacheKey);
    throw error;
  });

  decodedAudioPromiseCache.set(cacheKey, decodePromise);
  return decodePromise;
}

async function ensureVoiceAudioReady(voice) {
  await ensureAudioContext();

  const decodeTasks = [];
  for (let digit = 0; digit <= 9; digit += 1) {
    decodeTasks.push(decodeDigitAudio(voice, digit));
  }

  await Promise.all(decodeTasks);
}

async function primeAudioPlayback() {
  try {
    await ensureVoiceAudioReady(state.voice);
    updateAudioConfigStatus();
  } catch (error) {
    setAudioConfigWarning(error.message || 'Impossible de preparer les fichiers audio.');
    throw error;
  }
}

function playDigitAudio(digit) {
  setAudioWarning('');

  const cacheKey = getAudioCacheKey(state.voice, digit);
  const audioBuffer = decodedAudioBufferCache.get(cacheKey);
  if (!audioBuffer || !audioContext) {
    setAudioWarning(`Audio non prepare : ${getVoiceLabel(state.voice)} / chiffre ${digit}`);
    return;
  }

  stopActiveAudio();

  const sourceNode = audioContext.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(audioContext.destination);
  sourceNode.onended = () => {
    if (state.activeAudio === sourceNode) {
      state.activeAudio.disconnect();
      state.activeAudio = null;
    }
  };

  state.activeAudio = sourceNode;
  sourceNode.start(0);
}

function initWelcome() {
  resetTransientFlow();
  showScreen('welcome');
  updateAudioConfigStatus();
  updateVoiceSelector();
  updateDisplayMode();
}

async function startNewGame() {
  resetGameState();

  try {
    await primeAudioPlayback();
  } catch (error) {
    initWelcome();
    return;
  }

  startCountdown(() => startDisplay());
}

function startCountdown(callback) {
  resetTransientFlow();
  showScreen('countdown');

  const countdownEl = $('countdown-num');
  let count = 3;
  countdownEl.textContent = count;

  const tick = () => {
    count -= 1;
    if (count <= 0) {
      callback();
      return;
    }

    countdownEl.textContent = count;
    queueTimeout(tick, 1000);
  };

  queueTimeout(tick, 1000);
}

function startDisplay() {
  resetTransientFlow();

  state.sequence = generateSequence(state.level);
  state.answer = [];
  state.displayIndex = 0;

  showScreen('display');
  updateDisplayMeta();
  renderDots();
  syncPlaybackDigit();
  showNextDigit();
}

function renderDots() {
  const container = $('progress-dots');
  container.innerHTML = '';

  state.sequence.forEach((_, index) => {
    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.id = `dot-${index}`;
    container.appendChild(dot);
  });
}

function updateDots(activeIndex) {
  document.querySelectorAll('.dot').forEach((dot, index) => {
    dot.className = `dot${
      index < activeIndex ? ' shown' : index === activeIndex ? ' current' : ''
    }`;
  });
}

function showNextDigit() {
  const currentIndex = state.displayIndex;
  if (currentIndex >= state.sequence.length) {
    startInput();
    return;
  }

  updateDots(currentIndex);
  syncPlaybackDigit();
  playDigitAudio(state.sequence[currentIndex]);

  queueTimeout(() => {
    const dot = $(`dot-${currentIndex}`);
    if (dot) dot.className = 'dot shown';

    state.displayIndex += 1;

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
  $('input-prompt').textContent = `Retapez les ${pluralizeDigits(state.level)} entendus, puis validez.`;
  renderAnswer();
  updateSubmitButton();
}

function renderAnswer() {
  const container = $('answer-display');
  container.innerHTML = '';

  for (let index = 0; index < state.level; index += 1) {
    const slot = document.createElement('span');
    const hasValue = index < state.answer.length;
    slot.className = `answer-slot${hasValue ? ' filled' : ''}`;
    slot.textContent = hasValue ? state.answer[index] : '';
    container.appendChild(slot);
  }
}

function inputDigit(digit) {
  if (state.phase !== 'input' || state.answer.length >= state.level) return;

  state.answer.push(digit);
  renderAnswer();
  updateSubmitButton();
}

function deleteDigit() {
  if (state.phase !== 'input' || state.answer.length === 0) return;

  state.answer.pop();
  renderAnswer();
  updateSubmitButton();
}

function updateSubmitButton() {
  const submitButton = $('btn-submit');
  if (submitButton) {
    submitButton.disabled = state.answer.length !== state.level;
  }
}

function submitAnswer() {
  if (state.phase !== 'input' || state.answer.length !== state.level) return;

  const isCorrect = state.answer.join('') === state.sequence.join('');
  showTransition(isCorrect);
}

function showTransition(isCorrect) {
  resetTransientFlow();
  showScreen('transition');

  const willEndGame = !isCorrect && state.lives === 1;
  $('transition-title').textContent = willEndGame ? 'Fin de l’epreuve' : 'Reponse enregistree';
  $('transition-message').textContent = willEndGame
    ? 'Calcul du score final...'
    : 'Prochaine sequence...';

  queueTimeout(() => {
    if (isCorrect) {
      state.totalCorrect += 1;
      state.maxLevel = Math.max(state.maxLevel, state.level);
      state.level += 1;
      updateTopbar();
      startDisplay();
      return;
    }

    state.lives -= 1;
    updateTopbar();

    if (state.lives <= 0) {
      showGameOver();
      return;
    }

    startDisplay();
  }, ROUND_BREAK_MS);
}

function showGameOver() {
  resetTransientFlow();
  showScreen('gameover');

  $('final-score').textContent = getScore();
  $('stat-rounds').textContent = state.totalCorrect;
  $('stat-best').textContent = getScore();
  $('player-name').value = '';
  setSaveStatus(
    'Choisissez un fichier JSON existant pour y ajouter ce score, ou creez-en un nouveau.',
    'info'
  );

  queueTimeout(() => $('player-name').focus(), 60);
}

function resetGameState() {
  resetTransientFlow();
  state.sequence = [];
  state.answer = [];
  state.level = 3;
  state.lives = 2;
  state.maxLevel = 2;
  state.totalCorrect = 0;
  state.displayIndex = 0;
  updateTopbar();
}

function setSaveStatus(message, tone = '') {
  const saveStatus = $('save-status');
  if (!saveStatus) return;

  saveStatus.textContent = message;
  saveStatus.className = `save-status${tone ? ` ${tone}` : ''}`;
}

function normalizeStoredScores(rawText) {
  if (!rawText.trim()) return [];

  const parsed = JSON.parse(rawText);
  if (parsed === null) return [];
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'object') return [parsed];

  throw new Error('Le fichier selectionne doit contenir un objet JSON ou un tableau JSON.');
}

function buildScoreEntry(name) {
  return {
    name,
    score: getScore(),
    roundsWon: state.totalCorrect,
    finalLevel: state.level,
    livesRemaining: state.lives,
    voice: state.voice,
    debugVisualMode: state.debugVisualMode,
    savedAt: new Date().toISOString(),
  };
}

function downloadJsonFallback(entries) {
  const blob = new Blob([JSON.stringify(entries, null, 2)], {
    type: 'application/json',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'digit-span-scores.json';
  link.click();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

async function saveScore() {
  const nameInput = $('player-name');
  const saveButton = $('btn-save-score');
  const name = nameInput.value.trim();

  if (!name) {
    setSaveStatus('Saisissez un nom avant d’enregistrer le score.', 'error');
    nameInput.focus();
    return;
  }

  saveButton.disabled = true;
  setSaveStatus('Enregistrement du score...', 'info');

  try {
    const entry = buildScoreEntry(name);

    if ('showSaveFilePicker' in window) {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: 'digit-span-scores.json',
        types: [
          {
            description: 'Fichier JSON',
            accept: {
              'application/json': ['.json'],
            },
          },
        ],
      });

      let scores = [];

      try {
        const file = await fileHandle.getFile();
        scores = normalizeStoredScores(await file.text());
      } catch (error) {
        if (error.name !== 'NotFoundError') {
          if (error instanceof SyntaxError) {
            throw new Error('Le fichier selectionne ne contient pas un JSON valide.');
          }
          throw error;
        }
      }

      scores.push(entry);

      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(scores, null, 2));
      await writable.close();

      setSaveStatus(`Score enregistre pour ${name}.`, 'success');
      return;
    }

    downloadJsonFallback([entry]);
    setSaveStatus(
      'Le score a ete telecharge au format JSON. L’ajout automatique a un fichier existant necessite un navigateur compatible.',
      'info'
    );
  } catch (error) {
    if (error && error.name === 'AbortError') {
      setSaveStatus('Enregistrement annule.', 'muted');
      return;
    }

    setSaveStatus(error.message || 'Impossible d’enregistrer le score.', 'error');
  } finally {
    saveButton.disabled = false;
  }
}

document.addEventListener('keydown', event => {
  if (state.phase !== 'input') return;

  if (event.key >= '0' && event.key <= '9') {
    event.preventDefault();
    inputDigit(Number(event.key));
    return;
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault();
    deleteDigit();
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    submitAnswer();
  }
});

function buildApp() {
  const app = $('app');
  app.innerHTML = `
    <div id="topbar">
      <span class="tb-logo">Digit Span</span>
      <div class="tb-stats">
        <span class="tb-stat">Niveau<span id="tb-level">—</span></span>
        <span class="tb-stat">Meilleur<span id="tb-best">—</span></span>
        <span class="tb-stat">Vies<span id="tb-lives">——</span></span>
      </div>
    </div>

    <div id="screen-welcome" class="screen">
      <div class="logo-mark">
        <svg viewBox="0 0 24 24"><rect x="4" y="4" width="5" height="5" rx="1"/><rect x="10" y="4" width="5" height="5" rx="1"/><rect x="16" y="4" width="5" height="5" rx="1"/><rect x="4" y="10" width="5" height="5" rx="1"/><rect x="16" y="10" width="5" height="5" rx="1"/><rect x="4" y="16" width="5" height="5" rx="1"/><rect x="10" y="16" width="5" height="5" rx="1"/><rect x="16" y="16" width="5" height="5" rx="1"/></svg>
      </div>
      <h1>Digit Span</h1>
      <p class="tagline">L’epreuve se fait en audio. Un chiffre est joue chaque seconde, puis vous retapez la sequence entendue.</p>

      <div class="info-grid">
        <div class="info-card"><div class="label">Niveau initial</div><div class="value">3 chiffres</div></div>
        <div class="info-card"><div class="label">Rythme</div><div class="value">1 audio par seconde</div></div>
        <div class="info-card"><div class="label">Vies</div><div class="value">2 erreurs</div></div>
        <div class="info-card"><div class="label">Validation</div><div class="value">Entrer ou Valider</div></div>
      </div>

      <div class="settings-panel">
        <div class="setting-card">
          <div class="setting-label">Voix audio</div>
          <div class="option-tabs" id="voice-selector"></div>
        </div>

        <label class="setting-card toggle-row" for="debug-visual-toggle">
          <div class="toggle-copy">
            <div class="setting-label">Debug visuel</div>
            <div class="setting-help">Affiche aussi les chiffres pendant la lecture audio.</div>
          </div>
          <span class="toggle-switch">
            <input id="debug-visual-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
          </span>
        </label>

        <div class="setting-note" id="audio-config-status"></div>
      </div>

      <button class="btn-primary" id="btn-start">Commencer</button>
    </div>

    <div id="screen-countdown" class="screen">
      <div class="countdown-label">Preparez-vous</div>
      <div class="countdown-num" id="countdown-num">3</div>
    </div>

    <div id="screen-display" class="screen">
      <div class="display-meta" id="display-level">Niveau 3 · Thomas · 3 chiffres</div>
      <div class="display-placeholder" id="display-placeholder">Lecture audio en cours</div>
      <div class="digit-container is-hidden" id="digit-container">
        <div class="digit-display" id="digit-display"></div>
      </div>
      <div class="audio-warning" id="audio-warning" aria-live="polite"></div>
      <div class="progress-dots" id="progress-dots"></div>
    </div>

    <div id="screen-input" class="screen">
      <div class="input-header">
        <div class="prompt" id="input-prompt">Retapez la sequence entendue, puis validez.</div>
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
        <button class="btn-action btn-del" id="btn-del">Effacer</button>
        <button class="btn-action btn-submit" id="btn-submit" disabled>Valider</button>
      </div>

      <div class="keyboard-hint" id="keyboard-hint">
        Clavier ou boutons numeriques, puis <kbd class="kbd">Entree</kbd> ou <kbd class="kbd">Valider</kbd>.
      </div>
    </div>

    <div id="screen-transition" class="screen">
      <div class="transition-title" id="transition-title">Reponse enregistree</div>
      <div class="transition-message" id="transition-message">Prochaine sequence...</div>
    </div>

    <div id="screen-gameover" class="screen">
      <div class="gameover-title">Resultat final</div>
      <div class="score-display" id="final-score">0</div>
      <div class="score-unit">chiffres</div>

      <div class="stats-row">
        <div class="stat-box">
          <div class="s-label">Series reussies</div>
          <div class="s-value" id="stat-rounds">0</div>
        </div>
        <div class="stat-box">
          <div class="s-label">Meilleur niveau</div>
          <div class="s-value" id="stat-best">0</div>
        </div>
      </div>

      <div class="save-card">
        <label class="save-label" for="player-name">Nom</label>
        <input class="text-input" id="player-name" type="text" maxlength="60" placeholder="Votre nom" />
        <button class="btn-primary save-btn" id="btn-save-score">Enregistrer le score</button>
        <p class="save-help">Selectionnez un fichier JSON existant pour ajouter le score, ou creez-en un nouveau.</p>
        <div class="save-status" id="save-status" aria-live="polite"></div>
      </div>

      <div class="gameover-btns">
        <button class="btn-ghost" id="btn-menu" style="flex:1">Menu</button>
        <button class="btn-primary" id="btn-retry" style="flex:2">Recommencer</button>
      </div>
    </div>
  `;

  renderVoiceSelector();

  $('btn-start').addEventListener('click', () => {
    startNewGame();
  });

  document.querySelectorAll('.num-btn').forEach(button => {
    button.addEventListener('click', () => inputDigit(Number(button.dataset.digit)));
  });

  $('debug-visual-toggle').addEventListener('change', event => {
    state.debugVisualMode = event.target.checked;
    updateDisplayMode();
  });

  $('btn-del').addEventListener('click', deleteDigit);
  $('btn-submit').addEventListener('click', submitAnswer);
  $('btn-retry').addEventListener('click', () => {
    startNewGame();
  });
  $('btn-menu').addEventListener('click', () => {
    resetGameState();
    initWelcome();
  });
  $('btn-save-score').addEventListener('click', () => {
    saveScore();
  });
  $('player-name').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveScore();
    }
  });

  $('debug-visual-toggle').checked = state.debugVisualMode;

  updateTopbar();
  updateAudioConfigStatus();
  updateDisplayMode();
  initWelcome();
}

buildApp();
