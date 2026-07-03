#!/usr/bin/env python3
"""
No-npm launcher for the Audio Digit Span Memory Test.

This single file replaces everything Vite/npm was doing:
  * serves the static frontend (index.html, /src, /audio)
  * provides the POST /api/results endpoint that writes score CSVs into
    resultats/<mode>/<name>.csv, matching the original vite.config.js exactly.

Requirements: Python 3 only (standard library).

Run:
    python3 serve.py
then open the printed URL in your browser.
"""

import json
import re
import unicodedata
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RESULTS_ROUTE = "/api/results"
PORT = 5173 


# ---------------------------------------------------------------------------
# CSV helpers (ported from vite.config.js)
# ---------------------------------------------------------------------------

def escape_csv(value):
    if isinstance(value, bool):          # match JS: true/false, not True/False
        s = "true" if value else "false"
    elif value is None:
        s = ""
    else:
        s = str(value)
    if re.search(r'[",\n\r]', s):
        return '"' + s.replace('"', '""') + '"'
    return s


def to_safe_file_name(name):
    ascii_name = unicodedata.normalize("NFD", name)
    ascii_name = "".join(c for c in ascii_name if unicodedata.category(c) != "Mn")
    ascii_name = ascii_name.lower()
    safe = re.sub(r"[^a-z0-9_-]+", "_", ascii_name)
    safe = re.sub(r"^_+|_+$", "", safe)
    return safe or "joueur"


def get_numeric_metadata_value(csv_text, key):
    m = re.search(rf"^{re.escape(key)},([^\r\n]+)$", csv_text, re.MULTILINE)
    if not m:
        return 0
    raw = m.group(1).strip().strip('"')
    try:
        return float(raw)
    except ValueError:
        return 0


def should_include_expected_answer(test_mode):
    return test_mode == "ordering"


def build_csv_content(p):
    include_expected = should_include_expected_answer(p["testMode"])
    if include_expected:
        round_header = ["round", "question", "expected_answer", "answer", "correct"]
        round_rows = [
            [r["round"], r["question"], r["expectedAnswer"], r["answer"], r["correct"]]
            for r in p["rounds"]
        ]
    else:
        round_header = ["round", "question", "answer", "correct"]
        round_rows = [
            [r["round"], r["question"], r["answer"], r["correct"]] for r in p["rounds"]
        ]

    rows = [
        ["metric", "value"],
        ["player_name", p["name"]],
        ["test_mode", p["testMode"]],
        ["score", p["score"]],
        ["high_score", p["highScore"]],
        ["rounds_won", p["roundsWon"]],
        ["final_level", p["finalLevel"]],
        ["voice", p["voice"]],
        ["debug_visual_mode", p["debugVisualMode"]],
        ["saved_at", p["savedAt"]],
        [],
        round_header,
        *round_rows,
    ]
    return "\n".join(
        "" if len(row) == 0 else ",".join(escape_csv(c) for c in row) for row in rows
    ) + "\n"


def _to_number(v, default=0):
    try:
        n = float(v)
        return n if n == n and n not in (float("inf"), float("-inf")) else default
    except (TypeError, ValueError):
        return default


def normalize_payload(raw):
    name = raw.get("name", "")
    name = name.strip() if isinstance(name, str) else ""
    if not name:
        raise ValueError("Le nom est obligatoire pour enregistrer le résultat.")

    test_mode = raw.get("testMode") if isinstance(raw.get("testMode"), str) else "forward"
    voice = raw.get("voice") if isinstance(raw.get("voice"), str) else ""
    saved_at = raw.get("savedAt") if isinstance(raw.get("savedAt"), str) else \
        datetime.now(timezone.utc).isoformat()
    rounds = raw.get("rounds") if isinstance(raw.get("rounds"), list) else []

    valid_modes = ["forward", "ordering"]
    subfolder = test_mode if test_mode in valid_modes else "forward"

    def fmt_num(n):
        # match JS: integers stay integer-looking, no trailing ".0"
        return int(n) if float(n).is_integer() else n

    return {
        "name": name,
        "subfolder": subfolder,
        "testMode": test_mode,
        "score": fmt_num(_to_number(raw.get("score"))),
        "roundsWon": fmt_num(_to_number(raw.get("roundsWon"))),
        "finalLevel": fmt_num(_to_number(raw.get("finalLevel"))),
        "voice": voice,
        "debugVisualMode": bool(raw.get("debugVisualMode")),
        "savedAt": saved_at,
        "rounds": [
            {
                "round": fmt_num(_to_number(r.get("round"), i + 1)) if r else i + 1,
                "question": str((r or {}).get("question", "")),
                "expectedAnswer": str((r or {}).get("expectedAnswer", ""))
                if should_include_expected_answer(test_mode) else "",
                "answer": str((r or {}).get("answer", "")),
                "correct": bool((r or {}).get("correct")),
            }
            for i, r in enumerate(rounds)
        ],
    }


def save_result(raw):
    payload = normalize_payload(raw)
    results_dir = ROOT / "resultats" / payload["subfolder"]
    file_name = to_safe_file_name(payload["name"]) + ".csv"
    file_path = results_dir / file_name
    rel_path = f"resultats/{payload['subfolder']}/{file_name}"

    results_dir.mkdir(parents=True, exist_ok=True)

    previous_high = 0
    if file_path.exists():
        existing = file_path.read_text(encoding="utf-8")
        previous_high = max(
            get_numeric_metadata_value(existing, "high_score"),
            get_numeric_metadata_value(existing, "score"),
        )

    high_score = max(previous_high, _to_number(payload["score"]))
    high_score = int(high_score) if float(high_score).is_integer() else high_score
    payload["highScore"] = high_score

    file_path.write_text(build_csv_content(payload), encoding="utf-8")
    return {"ok": True, "fileName": file_name, "relativePath": rel_path,
            "highScore": high_score}


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.rstrip("/") != RESULTS_ROUTE:
            self._send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8") if length else ""
            raw = json.loads(body) if body.strip() else {}
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "La requête doit contenir un JSON valide."})
            return
        try:
            self._send_json(200, save_result(raw))
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            self._send_json(400, {"error": f"Impossible d'enregistrer le résultat. ({e})"})

    def log_message(self, fmt, *args):
        pass  # keep the console quiet; comment out to see requests


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/"
    print("Audio Digit Span Memory Test - running with Python")
    print(f"Open: {url}")
    print("Results are saved to ./resultats/  |  Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.shutdown()


if __name__ == "__main__":
    main()