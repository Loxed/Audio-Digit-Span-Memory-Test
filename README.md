# Digit Span

Small audio-based digit span game built with Vite.

## What it does

The app plays a sequence of digits, one per second. The player listens and completes one of two test modes:

- `forward`: type the sequence exactly as heard
- `ordering`: type the heard digits sorted from smallest to largest

At the end of the game, the player can enter their name and save the result inside the application. A CSV file is written to `resultats/<name>.csv`.

# Running without npm / Node
 
This copy of the project has been adjusted so it runs with Python 3 only. 

## How to run
 
1. From this folder, start the app:
       `python3 serve.py`
 
2. Open the printed address in your browser:
       `http://127.0.0.1:5173/`
 

## Results format

Each saved CSV contains:

- metadata at the top: player name, test mode, score, high score, rounds won, final level, voice, timestamp
- one row per round with the generated sequence, the expected answer, the player answer, and whether it was correct

Example:

```csv
metric,value
player_name,leopold
test_mode,forward
score,4
high_score,4

round,question,expected_answer,answer,correct
1,107,107,107,true
2,941,941,941,true
3,6376,3676,0000,false
```

## Notes

- Audio files are stored in `audio/<voice>/` and must be named `chiffre_0.<ext>` through `chiffre_9.<ext>`.
- Supported audio formats include `.aiff`, `.aif`, `.wav`, `.mp3`, `.ogg`, `.opus`, `.m4a`, and `.webm`.
- Results are stored in `resultats/`.
- Internal saving works when the app is run through Vite (`npm run dev` or `npm run preview`).
