#!/usr/bin/env python3
"""Publish the Shopping Scout finds to the site from the local pipeline state.

Usage: publish_shopping.py [state_json]   (default C:/Users/dror/Portal/state/deals.json)
State shape: {"SEARCHES": [...], "ITEMS": [...], "META": {"built": "DD/MM/YYYY HH:MM", ...}}
Encrypts the shopping blob and registers it in the manifest.
"""
import datetime
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
today = datetime.date.today().isoformat()
now = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")

state_path = sys.argv[1] if len(sys.argv) > 1 else r"C:/Users/dror/Portal/state/deals.json"
st = json.load(open(state_path, encoding="utf-8"))
searches = st["SEARCHES"]
items = st["ITEMS"]
meta = st.get("META", {})

for it in items:
    assert it.get("sid") in {q["id"] for q in searches}, f"item {it.get('id')} has unknown sid"
    assert str(it.get("u", "")).startswith("https://"), f"item {it.get('id')} has non-https link"

shopping = {
    "built": meta.get("built", now),
    "mode": meta.get("mode", "full"),
    "searches": [{"id": q["id"], "name": q["name"], "notes": q.get("notes", ""), "active": q.get("active", True)}
                 for q in searches],
    "items": items,
}
live = [i for i in items if not i.get("gone")]

os.makedirs(os.path.join(ROOT, "data", today), exist_ok=True)
tmp = os.path.join(ROOT, "jobs", "_shopping.json")
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(shopping, f, ensure_ascii=False)
dst = os.path.join(ROOT, "data", today, "shopping.enc")
subprocess.run([sys.executable, os.path.join(ROOT, "jobs", "encrypt_blob.py"), tmp, dst, f"shopping-{today}"], check=True)
os.remove(tmp)

mpath = os.path.join(ROOT, "manifest.json")
manifest = json.load(open(mpath, encoding="utf-8")) if os.path.exists(mpath) else {"files": {}}
manifest["date"] = today
manifest["generated_at"] = now
manifest["files"]["shopping"] = f"data/{today}/shopping.enc"
manifest["files"].pop("home", None)
with open(mpath, "w", encoding="utf-8") as f:
    json.dump(manifest, f)
print(f"published shopping: {len(searches)} searches, {len(live)} live / {len(items)} total items, built {shopping['built']}")
