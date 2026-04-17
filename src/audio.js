import { PREFERRED_VOICE_ORDER, VOICE_LABELS } from './config.js';
import { state } from './state.js';

// ---------------------------------------------------------------------------
// Audio library — built from Vite's eager glob
// ---------------------------------------------------------------------------

const rawAudioModules = import.meta.glob('../audio/*/chiffre_*.aiff', {
  eager: true,
  import: 'default',
});

export const audioLibrary = buildAudioLibrary(rawAudioModules);
export const voiceOptions = getVoiceOptions();

const decodedAudioBufferCache = new Map();
const decodedAudioPromiseCache = new Map();

let audioContext = null;

// ---------------------------------------------------------------------------
// Library helpers
// ---------------------------------------------------------------------------

function buildAudioLibrary(modules) {
  const library = {};
  Object.entries(modules).forEach(([rawPath, source]) => {
    const p = rawPath.replace(/\\/g, '/');
    const match = p.match(/(?:^|\/)audio\/([^/]+)\/chiffre_(\d)\.aiff$/);
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
  return voices.sort((a, b) => {
    const ai = PREFERRED_VOICE_ORDER.indexOf(a);
    const bi = PREFERRED_VOICE_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export function getVoiceLabel(voice) {
  return VOICE_LABELS[voice] ?? `${voice.charAt(0).toUpperCase()}${voice.slice(1)}`;
}

export function getMissingDigits(voice) {
  const missing = [];
  for (let d = 0; d <= 9; d++) {
    if (!audioLibrary[voice]?.[d]) missing.push(d);
  }
  return missing;
}

function getAudioCacheKey(voice, digit) {
  return `${voice}:${digit}`;
}

// ---------------------------------------------------------------------------
// Web Audio context
// ---------------------------------------------------------------------------

export async function ensureAudioContext() {
  if (!audioContext) {
    const Cls = window.AudioContext || window.webkitAudioContext;
    if (!Cls) throw new Error('Web Audio API indisponible dans ce navigateur.');
    audioContext = new Cls();
  }
  if (audioContext.state === 'suspended') await audioContext.resume();
  return audioContext;
}

// ---------------------------------------------------------------------------
// AIFF parser
// ---------------------------------------------------------------------------

function readAscii(view, offset, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

function readExtendedFloat80(view, offset) {
  const exponentBits = view.getUint16(offset, false);
  const highMantissa = view.getUint32(offset + 2, false);
  const lowMantissa  = view.getUint32(offset + 6, false);
  if (exponentBits === 0 && highMantissa === 0 && lowMantissa === 0) return 0;
  const sign     = (exponentBits & 0x8000) !== 0 ? -1 : 1;
  const exponent = (exponentBits & 0x7fff) - 16383;
  const mantissa = highMantissa * 2 ** -31 + lowMantissa * 2 ** -63;
  return sign * mantissa * 2 ** exponent;
}

function readPcmSample(view, offset, bits) {
  switch (bits) {
    case 8:  return view.getInt8(offset);
    case 16: return view.getInt16(offset, false);
    case 24: {
      const b0 = view.getUint8(offset);
      const b1 = view.getUint8(offset + 1);
      const b2 = view.getUint8(offset + 2);
      let v = (b0 << 16) | (b1 << 8) | b2;
      if (v & 0x800000) v |= 0xff000000;
      return v;
    }
    case 32: return view.getInt32(offset, false);
    default: throw new Error(`Taille d'échantillon AIFF non supportée : ${bits} bits.`);
  }
}

function normalizePcmSample(sample, bits) {
  return Math.max(-1, Math.min(1, sample / 2 ** (bits - 1)));
}

function parseAiffBuffer(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (readAscii(view, 0, 4) !== 'FORM') throw new Error('Fichier audio invalide : en-tête FORM introuvable.');
  const formType = readAscii(view, 8, 4);
  if (formType !== 'AIFF' && formType !== 'AIFC') throw new Error(`Format audio non supporté : ${formType}.`);

  let channelCount = 0, frameCount = 0, bitsPerSample = 0, sampleRate = 0;
  let compressionType = 'NONE', soundDataOffset = 0, soundDataSize = 0;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId       = readAscii(view, offset, 4);
    const chunkSize     = view.getUint32(offset + 4, false);
    const chunkDataOff  = offset + 8;

    if (chunkId === 'COMM') {
      channelCount  = view.getUint16(chunkDataOff, false);
      frameCount    = view.getUint32(chunkDataOff + 2, false);
      bitsPerSample = view.getUint16(chunkDataOff + 6, false);
      sampleRate    = readExtendedFloat80(view, chunkDataOff + 8);
      if (formType === 'AIFC' && chunkSize >= 22) compressionType = readAscii(view, chunkDataOff + 18, 4);
    }

    if (chunkId === 'SSND') {
      const audioDataOffset = view.getUint32(chunkDataOff, false);
      soundDataOffset = chunkDataOff + 8 + audioDataOffset;
      soundDataSize   = Math.max(0, chunkSize - 8 - audioDataOffset);
    }

    offset = chunkDataOff + chunkSize + (chunkSize % 2);
  }

  if (compressionType !== 'NONE' && compressionType !== 'twos')
    throw new Error(`Compression audio non supportée : ${compressionType}.`);
  if (bitsPerSample % 8 !== 0 || bitsPerSample <= 0 || bitsPerSample > 32)
    throw new Error(`Profondeur audio non supportée : ${bitsPerSample} bits.`);
  if (!channelCount || !frameCount || !sampleRate || !soundDataOffset)
    throw new Error('Le fichier AIFF est incomplet ou corrompu.');

  const bytesPerSample  = bitsPerSample / 8;
  const bytesPerFrame   = bytesPerSample * channelCount;
  const safeFrameCount  = Math.min(frameCount, Math.floor(soundDataSize / bytesPerFrame));
  const channelData     = Array.from({ length: channelCount }, () => new Float32Array(safeFrameCount));

  let sampleOffset = soundDataOffset;
  for (let fi = 0; fi < safeFrameCount; fi++) {
    for (let ci = 0; ci < channelCount; ci++) {
      channelData[ci][fi] = normalizePcmSample(readPcmSample(view, sampleOffset, bitsPerSample), bitsPerSample);
      sampleOffset += bytesPerSample;
    }
  }

  return { channelData, channelCount, frameCount: safeFrameCount, sampleRate: Math.max(1, Math.round(sampleRate)) };
}

// ---------------------------------------------------------------------------
// Decode & cache
// ---------------------------------------------------------------------------

export async function decodeDigitAudio(voice, digit) {
  const key = getAudioCacheKey(voice, digit);
  if (decodedAudioBufferCache.has(key)) return decodedAudioBufferCache.get(key);
  if (decodedAudioPromiseCache.has(key)) return decodedAudioPromiseCache.get(key);

  const promise = (async () => {
    const source = audioLibrary[voice]?.[digit];
    if (!source) throw new Error(`Audio introuvable : audio/${voice}/chiffre_${digit}.aiff`);
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Impossible de charger audio/${voice}/chiffre_${digit}.aiff`);
    const arrayBuffer = await response.arrayBuffer();
    const parsed      = parseAiffBuffer(arrayBuffer);
    const ctx         = await ensureAudioContext();
    const audioBuffer = ctx.createBuffer(parsed.channelCount, parsed.frameCount, parsed.sampleRate);
    parsed.channelData.forEach((ch, i) => audioBuffer.copyToChannel(ch, i));
    decodedAudioBufferCache.set(key, audioBuffer);
    decodedAudioPromiseCache.delete(key);
    return audioBuffer;
  })().catch(err => { decodedAudioPromiseCache.delete(key); throw err; });

  decodedAudioPromiseCache.set(key, promise);
  return promise;
}

export async function ensureVoiceAudioReady(voice) {
  await ensureAudioContext();
  await Promise.all(Array.from({ length: 10 }, (_, d) => decodeDigitAudio(voice, d)));
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export function stopActiveAudio() {
  if (!state.activeAudio) return;
  try {
    state.activeAudio.onended = null;
    state.activeAudio.stop(0);
  } catch { /* already ended */ }
  state.activeAudio?.disconnect?.();
  state.activeAudio = null;
}

export function playDigitAudio(digit) {
  const key = getAudioCacheKey(state.voice, digit);
  const buf = decodedAudioBufferCache.get(key);
  if (!buf || !audioContext) return;

  stopActiveAudio();

  const src    = audioContext.createBufferSource();
  src.buffer   = buf;
  src.connect(audioContext.destination);
  src.onended  = () => {
    if (state.activeAudio === src) { src.disconnect(); state.activeAudio = null; }
  };
  state.activeAudio = src;
  src.start(0);
}
