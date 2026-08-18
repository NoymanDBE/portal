#!/usr/bin/env python3
"""Phase-1 sample edition: builds and encrypts a real manifest + home blob so the
unlock ceremony proves end-to-end decryption on day one."""
import datetime
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
today = datetime.date.today().isoformat()
now = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")

home = {
    "edition_line": f"PHASE 1 · {datetime.date.today().strftime('%A, %d %B %Y').upper()} · SHELL EDITION",
    "lead": "The foundation is live: your portal now runs on your own site, unlocked only by your key.",
    "news_status": "Verified stories with confidence scores — the 04:50 pipeline moves here in Phase 2.",
    "stocks_status": "Feasibility-first small-cap research — the 06:00 pipeline moves here in Phase 3.",
    "shopping_status": "Daily verified hunts for what you want — the 07:00 pipeline moves here in Phase 4.",
}

src = os.path.join(ROOT, "jobs", "_home.json")
with open(src, "w", encoding="utf-8") as f:
    json.dump(home, f, ensure_ascii=False)

dst = os.path.join(ROOT, "data", today, "home.enc")
subprocess.run([sys.executable, os.path.join(ROOT, "jobs", "encrypt_blob.py"), src, dst, f"home-{today}"], check=True)
os.remove(src)

manifest = {
    "date": today,
    "generated_at": now,
    "files": {"home": f"data/{today}/home.enc"},
}
with open(os.path.join(ROOT, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f)
print("sample edition written:", manifest)
