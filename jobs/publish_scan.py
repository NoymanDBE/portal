#!/usr/bin/env python3
"""Publish the Breakthrough Scan to the site from a saved artifact HTML.

Usage: publish_scan.py <saved_artifact_html>
Slices the real document (first <title> after __FRAME_PREAMBLE .. last </body></html> —
the engine embeds template copies of the page inside JS strings), lifts the data layer
(var C / P / PORT / ASIDE / STRIP) plus the header text, encrypts it as the stocks blob,
and updates the manifest.
"""
import datetime
import html as htmllib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
today = datetime.date.today().isoformat()
now = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")

src = open(sys.argv[1], encoding="utf-8").read()
if "__FRAME_PREAMBLE" in src:
    pre = src.index("__FRAME_PREAMBLE")
    src = src[src.index("<title>", pre):src.rindex("</body></html>")]


def var(name, default=None):
    m = re.search(r"\bvar %s = (.*?);\n" % name, src, re.S)
    if not m:
        if default is not None:
            return default
        raise SystemExit(f"var {name} not found — artifact layout changed?")
    return json.loads(m.group(1))


def text(pattern, flags=0):
    m = re.search(pattern, src, flags)
    if not m:
        return ""
    return htmllib.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).strip()


C = var("C")
P = var("P")
PORT = var("PORT", [])
ASIDE = var("ASIDE", [])
STRIP = var("STRIP", [])

built = text(r'id="built">Updated <span class="ltr">(.*?)</span>')
kicker = text(r'<div class="kicker">(.*?)</div>')
h1 = text(r"<h1>(.*?)</h1>")
dateline = re.sub(r"\s+", " ", text(r'id="dateline">(.*?)</div>', re.S))
gist_m = re.search(r'<div class="gist">(.*?)\n\s*</div>', src, re.S)
gist = []
if gist_m:
    for frag in re.findall(r"<(?:p|li)>(.*?)</(?:p|li)>", gist_m.group(1), re.S):
        t = htmllib.unescape(re.sub(r"<[^>]+>", "", frag)).strip()
        if t:
            gist.append(re.sub(r"\s+", " ", t))

scan = [c for c in C if c.get("t") not in PORT]
tally = {v: sum(1 for c in scan if c.get("v") == v) for v in ("buy", "wait", "refrain")}

stocks = {
    "built": built, "kicker": kicker, "h1": h1, "dateline": dateline,
    "gist": gist, "tally": tally,
    "strip": STRIP, "port": PORT, "aside": ASIDE,
    "C": C, "P": P,
}

os.makedirs(os.path.join(ROOT, "data", today), exist_ok=True)
tmp = os.path.join(ROOT, "jobs", "_stocks.json")
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(stocks, f, ensure_ascii=False)
dst = os.path.join(ROOT, "data", today, "stocks.enc")
subprocess.run([sys.executable, os.path.join(ROOT, "jobs", "encrypt_blob.py"), tmp, dst, f"stocks-{today}"], check=True)
os.remove(tmp)

mpath = os.path.join(ROOT, "manifest.json")
manifest = json.load(open(mpath, encoding="utf-8")) if os.path.exists(mpath) else {"files": {}}
manifest["date"] = today
manifest["generated_at"] = now
manifest["files"]["stocks"] = f"data/{today}/stocks.enc"
with open(mpath, "w", encoding="utf-8") as f:
    json.dump(manifest, f)
in_aside_not_c = [t for t in ASIDE if t not in [c.get("t") for c in C]]
print(f"published stocks board: {len(scan)} scanned ({tally['buy']}/{tally['wait']}/{tally['refrain']}), "
      f"{len(PORT)} portfolio, {len(ASIDE)} dropped (missing from C: {in_aside_not_c}), built {built}")
