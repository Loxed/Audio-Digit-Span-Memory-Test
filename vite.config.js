import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';

const RESULTS_ROUTE = '/api/results';

function escapeCsv(value) {
  const stringValue = String(value ?? '');
  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/"/g, '""')}"`;
}

function toSafeFileName(name) {
  const asciiName = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const sanitizedName = asciiName
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitizedName || 'joueur';
}

function getNumericMetadataValue(csvText, key) {
  const match = csvText.match(new RegExp(`^${key},([^\\r\\n]+)$`, 'm'));
  if (!match) return 0;

  const rawValue = match[1].replace(/^"|"$/g, '').trim();
  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function buildCsvContent(payload) {
  const rows = [
    ['metric', 'value'],
    ['player_name', payload.name],
    ['test_mode', payload.testMode],
    ['score', payload.score],
    ['high_score', payload.highScore],
    ['rounds_won', payload.roundsWon],
    ['final_level', payload.finalLevel],
    ['voice', payload.voice],
    ['debug_visual_mode', payload.debugVisualMode],
    ['saved_at', payload.savedAt],
    [],
    ['round', 'question', 'expected_answer', 'answer', 'correct'],
    ...payload.rounds.map(round => [
      round.round,
      round.question,
      round.expectedAnswer,
      round.answer,
      round.correct,
    ]),
  ];

  return `${rows
    .map(row => (row.length === 0 ? '' : row.map(escapeCsv).join(',')))
    .join('\n')}\n`;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('La requete doit contenir un JSON valide.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function normalizePayload(rawPayload) {
  const name = typeof rawPayload?.name === 'string' ? rawPayload.name.trim() : '';
  if (!name) {
    throw new Error('Le nom est obligatoire pour enregistrer le resultat.');
  }

  const score = Number(rawPayload.score);
  const roundsWon = Number(rawPayload.roundsWon);
  const finalLevel = Number(rawPayload.finalLevel);
  const testMode = typeof rawPayload.testMode === 'string' ? rawPayload.testMode : 'forward';
  const voice = typeof rawPayload.voice === 'string' ? rawPayload.voice : '';
  const savedAt = typeof rawPayload.savedAt === 'string' ? rawPayload.savedAt : new Date().toISOString();
  const rounds = Array.isArray(rawPayload.rounds) ? rawPayload.rounds : [];

  return {
    name,
    testMode,
    score: Number.isFinite(score) ? score : 0,
    roundsWon: Number.isFinite(roundsWon) ? roundsWon : 0,
    finalLevel: Number.isFinite(finalLevel) ? finalLevel : 0,
    voice,
    debugVisualMode: Boolean(rawPayload.debugVisualMode),
    savedAt,
    rounds: rounds.map((round, index) => ({
      round: Number.isFinite(Number(round?.round)) ? Number(round.round) : index + 1,
      question: String(round?.question ?? ''),
      expectedAnswer: String(round?.expectedAnswer ?? ''),
      answer: String(round?.answer ?? ''),
      correct: Boolean(round?.correct),
    })),
  };
}

function resultsPersistencePlugin() {
  let rootDir = process.cwd();

  const handleSave = async (request, response) => {
    try {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Utilisez POST pour enregistrer un resultat.' });
        return;
      }

      const payload = normalizePayload(await readJsonBody(request));
      const resultsDir = path.resolve(rootDir, 'resultats');
      const fileName = `${toSafeFileName(payload.name)}.csv`;
      const filePath = path.join(resultsDir, fileName);

      await mkdir(resultsDir, { recursive: true });

      let previousHighScore = 0;
      try {
        const existingCsv = await readFile(filePath, 'utf8');
        previousHighScore = Math.max(
          getNumericMetadataValue(existingCsv, 'high_score'),
          getNumericMetadataValue(existingCsv, 'score')
        );
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }

      const highScore = Math.max(previousHighScore, payload.score);
      const csvContent = buildCsvContent({
        ...payload,
        highScore,
      });

      await writeFile(filePath, csvContent, 'utf8');

      sendJson(response, 200, {
        ok: true,
        fileName,
        relativePath: `resultats/${fileName}`,
        highScore,
      });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : 'Impossible d’enregistrer le resultat.',
      });
    }
  };

  const attachMiddleware = server => {
    server.middlewares.use(RESULTS_ROUTE, (request, response) => {
      void handleSave(request, response);
    });
  };

  return {
    name: 'results-persistence',
    configResolved(config) {
      rootDir = path.resolve(config.root);
    },
    configureServer(server) {
      attachMiddleware(server);
    },
    configurePreviewServer(server) {
      attachMiddleware(server);
    },
  };
}

export default defineConfig({
  assetsInclude: ['**/*.aiff'],
  plugins: [resultsPersistencePlugin()],
});
