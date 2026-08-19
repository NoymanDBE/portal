#!/usr/bin/env python3
"""Publish a Morning News edition to the site from a saved paper HTML (bridge mode)
or, later, from a JSON the 04:50 job generates directly.

Usage: publish_news.py <saved_artifact_html>
Extracts var PAPER / var ARCH, wraps them as the news blob, encrypts, updates manifest,
and refreshes the home blob with the edition's real lead.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
today = datetime.date.today().isoformat()
now = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"


def image_alive(url):
    """A URL earns a place on the page only if it serves a real image right now."""
    if not re.match(r"^https://", url or ""):
        return False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": "bytes=0-2047"})
        with urllib.request.urlopen(req, timeout=8) as r:
            ctype = r.headers.get("Content-Type", "")
            head = r.read(2048)
            if not ctype.startswith("image/"):
                return False
            magic = (head[:2] == b"\xff\xd8"                      # jpeg
                     or head[:8] == b"\x89PNG\r\n\x1a\n"          # png
                     or head[:4] == b"RIFF"                       # webp
                     or head[:6] in (b"GIF87a", b"GIF89a")        # gif
                     or head[4:8] == b"ftyp")                     # avif/heic
            return magic
    except Exception:
        return False


def validate_images(sections):
    kept, dropped = 0, 0
    for s in sections:
        for g in s.get("groups", []):
            for st in g.get("stories", []):
                img = st.get("img")
                if not img:
                    continue
                if isinstance(img, dict) and image_alive(img.get("u", "")):
                    kept += 1
                else:
                    st.pop("img", None)
                    dropped += 1
    return kept, dropped


src_html = open(sys.argv[1], encoding="utf-8").read()
paper = json.loads(re.search(r"var PAPER = (\{.*?\});\n", src_html).group(1))
arch_m = re.search(r"var ARCH = (\[.*?\]);\n", src_html)
arch = json.loads(arch_m.group(1)) if arch_m else []

img_kept, img_dropped = validate_images(paper.get("sections", []))

news = {
    "edition_line": f"{paper.get('hdate', '').upper()} · GENERATED {paper.get('built', '')} IST",
    "date": paper.get("date"),
    "built": paper.get("built"),
    "lead": paper.get("lead"),
    "keys": paper.get("keys", []),
    "brief": paper.get("brief", []),
    "markets": paper.get("markets", []),
    "mktNote": paper.get("mktNote", ""),
    "sections": paper.get("sections", []),
    "archive": arch,
}
n_stories = sum(len(g.get("stories", [])) for s in news["sections"] for g in s.get("groups", []))

home = {
    "edition_line": f"{paper.get('hdate', '').upper()} · {n_stories} STORIES · EDITION OF {paper.get('date', '')}",
    "lead": (paper.get("keys") or [paper.get("lead", "")])[0],
    "news_status": f"Today's edition: {n_stories} stories across {len(news['sections'])} sections. Generated {paper.get('built', '')}.",
    "stocks_status": "Feasibility-first small-cap research — moves here in Phase 3.",
    "shopping_status": "Daily verified hunts for what you want — moves here in Phase 4.",
}

os.makedirs(os.path.join(ROOT, "data", today), exist_ok=True)
for name, payload in [("news", news), ("home", home)]:
    tmp = os.path.join(ROOT, "jobs", f"_{name}.json")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    dst = os.path.join(ROOT, "data", today, f"{name}.enc")
    subprocess.run([sys.executable, os.path.join(ROOT, "jobs", "encrypt_blob.py"), tmp, dst, f"{name}-{today}"], check=True)
    os.remove(tmp)

mpath = os.path.join(ROOT, "manifest.json")
manifest = json.load(open(mpath, encoding="utf-8")) if os.path.exists(mpath) else {"files": {}}
manifest["date"] = today
manifest["generated_at"] = now
manifest["files"]["home"] = f"data/{today}/home.enc"
manifest["files"]["news"] = f"data/{today}/news.enc"
with open(mpath, "w", encoding="utf-8") as f:
    json.dump(manifest, f)
print(f"published news edition: {n_stories} stories, images kept {img_kept} / dropped {img_dropped}, manifest updated")
