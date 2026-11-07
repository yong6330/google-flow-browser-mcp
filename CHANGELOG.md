# Changelog

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
