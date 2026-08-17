# Dror's Portal — Android app

A native Android app for the three daily dashboards (The Edition, Breakthrough Scan,
Deal Hunter) with a home-screen **widget** showing today's headline, the market line
and new shopping finds.

- The app itself is a WebView over the claude.ai artifact pages — sign in to
  claude.ai once inside the app and the login persists.
- The widget reads three small JSON feeds (`news.json`, `stocks.json`,
  `shopping.json`) that the daily cloud routines push to this repo under `feeds/`.
  Until the feeds exist, the widget works as tap-shortcuts to the three apps.

## One-time setup (about 5 minutes)

1. Create a GitHub account if needed, then create a repository (e.g. `portal`),
   **public** (raw file URLs must be reachable by the widget without auth).
2. Push this folder to it:

   ```
   cd C:\Users\dror\Portal\app
   git init -b main
   git add .
   git commit -m "Portal app"
   git remote add origin https://github.com/<USER>/portal.git
   git push -u origin main
   ```

3. GitHub → the repo → **Actions** tab: the "Build APK" workflow runs
   automatically and attaches `app-debug.apk` under **Releases → latest**.
4. On the phone: download the APK from the release page → allow
   "install unknown apps" for the browser → install.
5. Add the widget: long-press home screen → Widgets → Dror's Portal.
   In the config screen paste the feed base URL:
   `https://raw.githubusercontent.com/<USER>/portal/main/feeds`
   (or Skip to use it as shortcuts only).
6. Tell Claude the repo exists — the daily routines then get one extra step:
   push the three feed JSONs on every run.

## Feed format (written by the routines)

```
feeds/news.json     {"date":"18/08/2026","headline":"..."}
feeds/stocks.json   {"updated":"...","line":"NVDA +2.1% · OCUL -0.8% · S&P flat"}
feeds/shopping.json {"updated":"...","new_count":2,"top":"Cartier Santos $5,135 (below market)"}
```

## Caveats

- The APK is debug-signed by CI; if a later build refuses to install over the old
  one, uninstall first (the login inside the app will need re-entering).
- The feeds sit in a public repo: headlines/tickers only, no account data. Keep it
  that way — nothing personal goes into `feeds/`.
