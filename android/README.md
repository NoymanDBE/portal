# Dror's Portal — Android app

A native Android app for the three daily dashboards (The Edition, Breakthrough Scan,
Deal Hunter) with a home-screen **widget** showing today's headline, the market line
and new shopping finds.

- The app is a WebView over the claude.ai artifact pages — sign in to claude.ai once
  inside the app and the login persists.
- The widget reads three small JSON feeds (`feeds/news.json`, `feeds/stocks.json`,
  `feeds/shopping.json`) that the daily cloud routines push to this repo. The repo is
  **private**: the widget authenticates with a read-only fine-grained access token,
  so nobody but Dror can see the feeds. Until the feeds exist, the widget works as
  tap-shortcuts to the three apps.

## Installing the app

1. Repo → **Actions** tab: the "Build APK" workflow runs on every push and attaches
   `app-debug.apk` under **Releases → latest**.
2. On the phone (signed in to GitHub in the browser): open the release page,
   download the APK, allow "install unknown apps" for the browser, install.

## Widget setup (private feeds)

1. Create a read-only token: GitHub → Settings → Developer settings →
   **Fine-grained personal access tokens** → Generate new token →
   Repository access: *Only select repositories* → this repo →
   Permissions → Contents: **Read-only** → Generate. Copy the `github_pat_…` string.
2. Long-press the home screen → Widgets → Dror's Portal → place it.
3. In the config screen: repo `NoymanDBE/portal`, paste the token, Save.

The widget refreshes every ~30 minutes through the GitHub API; tapping a line opens
the matching app.

## Feed format (written by the routines)

```
feeds/news.json     {"date":"18/08/2026","headline":"..."}
feeds/stocks.json   {"updated":"...","line":"NVDA +2.1% · OCUL -0.8% · S&P flat"}
feeds/shopping.json {"updated":"...","new_count":2,"top":"Cartier Santos $5,135 (below market)"}
```

## Caveats

- The APK is debug-signed by CI; if a later build refuses to install over the old
  one, uninstall first (the claude.ai login inside the app will need re-entering).
- Keep the repo private. The feed token is read-only and scoped to this single repo —
  if it ever leaks, revoke it in GitHub settings and paste a new one into the widget.
