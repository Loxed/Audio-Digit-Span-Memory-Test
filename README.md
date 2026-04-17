# Digit Span

Small audio-based digit span game built with Vite.

## What it does

The app plays a sequence of digits, one per second. The player listens, types the sequence back, and the game continues until both lives are lost.

At the end of the game, the player can enter their name and save the result inside the application. A CSV file is written to `resultats/<name>.csv`.

## Run locally

```bash
npm install
npm run dev
```

Then open the local Vite URL in your browser.

## Build

```bash
npm run build
```

## Results format

Each saved CSV contains:

- metadata at the top: player name, score, high score, rounds won, final level, voice, timestamp
- one row per round with the generated sequence, the player answer, and whether it was correct

Example:

```csv
metric,value
player_name,leopold
score,4
high_score,4

round,question,answer,correct
1,107,107,true
2,941,941,true
3,6376,0000,false
```

## Notes

- Audio files are stored in `audio/`.
- Results are stored in `resultats/`.
- Internal saving works when the app is run through Vite (`npm run dev` or `npm run preview`).
