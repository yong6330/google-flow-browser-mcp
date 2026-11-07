# Changelog

## 2.1.0

Field-tested against the November 2026 Flow UI in Korean (dry runs only; no credits spent).

- The server now works in its own background tab and never brings a tab to the front. The user's tabs, focus and scroll stay untouched. `flow_disconnect` closes only that tab.
- Default `flowUrl` is `https://flow.google.com/`. Project names are read from the card title because every card link reads "Open project".
- Account panel: Flow's header button first, wait for the email before reading, close with the close icon (Escape is ignored). `flow_doctor` and `flow_credits` now return the balance.
- The English login pattern no longer matches the reCAPTCHA footer notice.
- Section navigation is scoped to the `role="navigation"` list. `unique()` waits briefly for late-rendered elements before counting.
- Settings options are matched by label with icon ligatures removed. Model names ignore case, spaces and dashes (`Veo 3.1 Fast` selects `Veo 3.1 - Fast`).
- The model is picked before the other options because it decides which options exist. `model`, `resolution` and `duration` are optional and keep Flow's current selection when omitted.
- Length works with the new slider (any whole second the model allows) and the older 4/6/8/10 buttons.
- Selected states are polled briefly after a click instead of read once.

## 2.0.0

- Optional platform user config, validated environment overrides and dedicated persistent data directories.
- System Chrome/Chromium/Edge discovery and detached CDP launch; no profile copying, unrelated-port termination or browser download.
- `google-flow-mcp` executable, Node 18+, ESM, `playwright-core`.
- Shared selectors and Korean/English/French/Japanese dictionaries with config extensions.
- Virtual-grid inventory, project operations, upload, guarded rename, reversible trash/restore, safe downloads and cleanup.
- Dry-run paid actions, optional account verification, credit-floor checks, explicit 4K opt-in.
- Bounded queue, persisted write-ahead intents, duplicate protection, job status/cancel and polling recovery.
- Portable doctor/launcher/manual smoke scripts, offline tests and MCP stdio handshake coverage.
- Removed personal paths, locale-specific defaults, saved personal selector snapshots and obsolete registration scripts.
- Breaking: config moves out of the repository; regular profiles are never reused. No automatic screenshots. Flow layout changes fail closed.
- New live UI paths remain unverified; see architecture checklist before live acceptance.

Original implementation and design: TMSSS05/google-flow-browser-mcp (MIT). Fork credit and LICENSE retained.

### Notes
- `flow_upscale_download` accepts `accept_unknown_cost:true` for accounts where Flow shows no upscale cost; without it, an unknown cost blocks the paid action.
