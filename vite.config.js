import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';

const RESULTS_ROUTE = '/api/results';

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function escapeCsv(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toSafeFileName(name) {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const safe  = ascii.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'joueur';
}

function getNumericMetadataValue(csvText, key) {
  const match = csvText.match(new RegExp(`^${key},([^\\r\\n]+)$`, 'm'));
  if (!match) return 0;
  const raw = match[1].replace(/^"|"$/g, '').trim();
  const n   = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function shouldIncludeExpectedAnswer(testMode) {
  return testMode === 'ordering';
}

function buildCsvContent(payload) {
  const includeExpectedAnswer = shouldIncludeExpectedAnswer(payload.testMode);
  const roundHeader = includeExpectedAnswer
    ? ['round', 'question', 'expected_answer', 'answer', 'correct']
    : ['round', 'question', 'answer', 'correct'];
  const roundRows = payload.rounds.map(r => includeExpectedAnswer
    ? [r.round, r.question, r.expectedAnswer, r.answer, r.correct]
    : [r.round, r.question, r.answer, r.correct]
  );

  const rows = [
    ['metric', 'value'],
    ['player_name',       payload.name],
    ['test_mode',         payload.testMode],
    ['score',             payload.score],
    ['high_score',        payload.highScore],
    ['rounds_won',        payload.roundsWon],
    ['final_level',       payload.finalLevel],
    ['voice',             payload.voice],
    ['debug_visual_mode', payload.debugVisualMode],
    ['saved_at',          payload.savedAt],
    [],
    roundHeader,
    ...roundRows,
  ];

  return rows.map(row => row.length === 0 ? '' : row.map(escapeCsv).join(',')).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data',  chunk => { body += chunk; });
    req.on('end',   ()    => {
      if (!body.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(body)); } catch { reject(new Error('La requête doit contenir un JSON valide.')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Payload validation / normalization
// ---------------------------------------------------------------------------

function normalizePayload(raw) {
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  if (!name) throw new Error('Le nom est obligatoire pour enregistrer le résultat.');

  const testMode   = typeof raw.testMode === 'string' ? raw.testMode : 'forward';
  const score      = Number(raw.score);
  const roundsWon  = Number(raw.roundsWon);
  const finalLevel = Number(raw.finalLevel);
  const voice      = typeof raw.voice === 'string' ? raw.voice : '';
  const savedAt    = typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString();
  const rounds     = Array.isArray(raw.rounds) ? raw.rounds : [];

  // Subfolder is derived from testMode — no suffix in filename
  const validModes = ['forward', 'ordering'];
  const subfolder  = validModes.includes(testMode) ? testMode : 'forward';

  return {
    name,
    subfolder,
    testMode,
    score:          Number.isFinite(score)      ? score      : 0,
    roundsWon:      Number.isFinite(roundsWon)  ? roundsWon  : 0,
    finalLevel:     Number.isFinite(finalLevel) ? finalLevel : 0,
    voice,
    debugVisualMode: Boolean(raw.debugVisualMode),
    savedAt,
    rounds: rounds.map((r, i) => ({
      round:          Number.isFinite(Number(r?.round)) ? Number(r.round) : i + 1,
      question:       String(r?.question       ?? ''),
      expectedAnswer: shouldIncludeExpectedAnswer(testMode) ? String(r?.expectedAnswer ?? '') : '',
      answer:         String(r?.answer         ?? ''),
      correct:        Boolean(r?.correct),
    })),
  };
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleSave(req, res, rootDir) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Utilisez POST pour enregistrer un résultat.' });
    return;
  }

  try {
    const payload    = normalizePayload(await readJsonBody(req));

    // resultats/forward/<name>.csv  or  resultats/ordering/<name>.csv
    const resultsDir = path.resolve(rootDir, 'resultats', payload.subfolder);
    const fileName   = `${toSafeFileName(payload.name)}.csv`;
    const filePath   = path.join(resultsDir, fileName);
    const relPath    = `resultats/${payload.subfolder}/${fileName}`;

    await mkdir(resultsDir, { recursive: true });

    let previousHighScore = 0;
    try {
      const existing        = await readFile(filePath, 'utf8');
      previousHighScore     = Math.max(
        getNumericMetadataValue(existing, 'high_score'),
        getNumericMetadataValue(existing, 'score')
      );
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }

    const highScore  = Math.max(previousHighScore, payload.score);
    const csvContent = buildCsvContent({ ...payload, highScore });

    await writeFile(filePath, csvContent, 'utf8');

    sendJson(res, 200, { ok: true, fileName, relativePath: relPath, highScore });
  } catch (err) {
    sendJson(res, 400, {
      error: err instanceof Error ? err.message : "Impossible d'enregistrer le résultat.",
    });
  }
}

// ---------------------------------------------------------------------------
// Vite plugin
// ---------------------------------------------------------------------------

function resultsPersistencePlugin() {
  let rootDir = process.cwd();

  const attach = server => {
    server.middlewares.use(RESULTS_ROUTE, (req, res) => {
      void handleSave(req, res, rootDir);
    });
  };

  return {
    name: 'results-persistence',
    configResolved(config) { rootDir = path.resolve(config.root); },
    configureServer(server)        { attach(server); },
    configurePreviewServer(server) { attach(server); },
  };
}

export default defineConfig({
  assetsInclude: /\.(aiff|aif|wav|mp3|ogg|opus|m4a|webm)$/i,
  plugins: [resultsPersistencePlugin()],
});
