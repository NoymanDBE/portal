#!/usr/bin/env python3
"""Locally enrich today's edition with photos before mirroring.

The cloud routine can't fetch article pages (egress proxy), so photo sourcing
falls to this machine: given the artifact HTML and a map of headline-fragment ->
source-article URLs, pull each article's og:image verbatim, validate it serves a
real image, and inject {u, cap, credit} into the matching story.

Usage: enrich_photos.py <artifact_html_in> <enriched_html_out> <map.json>
map.json: [{"match": "headline fragment", "urls": ["article url", ...]}, ...]
"""
import html as htmllib
import json
import re
import sys
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
BAD_NAME = re.compile(r"(logo|defaultshareimage|global_defalt|placeholder|sprite|og-image|avatar)", re.I)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read(600_000).decode("utf-8", "replace")


def meta(page, prop):
    m = re.search(r'<meta[^>]+(?:property|name)=["\']' + re.escape(prop) + r'["\'][^>]+content=["\']([^"\']+)["\']', page)
    if not m:
        m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + re.escape(prop) + r'["\']', page)
    return htmllib.unescape(m.group(1)).strip() if m else ""


def image_alive(url):
    if not re.match(r"^https://", url or "") or "aljazeera" in url:
        return False
    if BAD_NAME.search(url.rsplit("/", 1)[-1].split("?")[0]):
        return False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": "bytes=0-2047",
                                                   "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"})
        with urllib.request.urlopen(req, timeout=10) as r:
            ctype = r.headers.get("Content-Type", "")
            head = r.read(2048)
            if not ctype.startswith("image/") or ctype.startswith("image/svg"):
                return False
            magic = (head[:2] == b"\xff\xd8" or head[:8] == b"\x89PNG\r\n\x1a\n"
                     or head[:4] == b"RIFF" or head[:6] in (b"GIF87a", b"GIF89a") or head[4:8] == b"ftyp")
            cr = r.headers.get("Content-Range", "")
            total = int(cr.split("/")[-1]) if "/" in cr else int(r.headers.get("Content-Length") or 0)
            if total and total < 15000:
                return False
            return magic
    except Exception:
        return False


def find_photo(urls):
    for url in urls:
        try:
            page = fetch(url)
        except Exception as e:
            print(f"    fetch failed {url[:70]}: {type(e).__name__}")
            continue
        img = meta(page, "og:image") or meta(page, "twitter:image")
        if not img:
            print(f"    no og:image at {url[:70]}")
            continue
        if not image_alive(img):
            print(f"    og:image failed validation: {img[:90]}")
            continue
        cap = meta(page, "og:image:alt")
        credit = meta(page, "og:site_name") or re.sub(r"^www\.", "", url.split("/")[2])
        return {"u": img, "cap": cap[:160], "credit": credit[:80]}
    return None


src_path, out_path, map_path = sys.argv[1], sys.argv[2], sys.argv[3]
html = open(src_path, encoding="utf-8").read()
paper_m = re.search(r"var PAPER = (\{.*?\});\n", html)
paper = json.loads(paper_m.group(1))
targets = json.load(open(map_path, encoding="utf-8"))

added = 0
for t in targets:
    hit = None
    for s in paper["sections"]:
        for g in s.get("groups", []):
            for st in g.get("stories", []):
                if t["match"].lower() in st.get("h", "").lower():
                    hit = st
                    break
    if not hit:
        print(f"NO MATCH: {t['match']}")
        continue
    if hit.get("img"):
        continue
    print(f"story: {hit['h'][:70]}")
    photo = find_photo(t["urls"])
    if photo:
        hit["img"] = photo
        added += 1
        print(f"    OK {photo['u'][:90]}  credit={photo['credit']}")

new_line = "var PAPER = " + json.dumps(paper, ensure_ascii=False) + ";\n"
html = html[:paper_m.start()] + new_line + html[paper_m.end():]
open(out_path, "w", encoding="utf-8").write(html)
print(f"enriched: {added} photos injected -> {out_path}")
