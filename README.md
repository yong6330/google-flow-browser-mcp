# Google Flow Browser MCP 2.0

Control Google Flow image and video creation from Claude Code, Claude Desktop, Cursor, or another MCP client, using your own Google account in a real Chrome/Chromium/Edge window. No API key, profile copying, browser download, or configuration file is required. Sign in manually once in a dedicated persistent profile.

**Fork notice:** fork of [TMSSS05/google-flow-browser-mcp](https://github.com/TMSSS05/google-flow-browser-mcp). Credit for the original design belongs to TMSSS05. Original and fork contributions are covered by the [MIT license](LICENSE).

This refactor has offline coverage. Its new browser workflows have **not been validated against a signed-in live Flow session**. Selectors fail closed when the page differs. See the [live verification checklist](docs/ARCHITECTURE.md#live-verification-checklist).

## Requirements and 60-second quick start

Install Node.js 18+ and a system Chrome, Chromium, or Microsoft Edge. Flow availability, account access, subscriptions, and credits depend on Google.

```sh
claude mcp add google-flow -- npx -y github:yong6330/google-flow-browser-mcp
```

Restart the MCP client, ask it to call `flow_connect`, and sign in in the visible dedicated browser window. Run `flow_connect` again after sign-in. Ask for `flow_projects` with `action: "list"`, then open a project. Ask for a dry-run image or video setup; inspect the settings and cost before giving confirmation.

The GitHub command installs the version currently on that repository's default branch. Local changes on `universal-v2` are available only locally until the maintainer publishes them. This work does not push or change remotes.

Claude Desktop configuration (merge into its existing `mcpServers` object):

```json
{
  "mcpServers": {
    "google-flow": {
      "command": "npx",
      "args": ["-y", "github:yong6330/google-flow-browser-mcp"]
    }
  }
}
```

Cursor's MCP configuration uses the same `mcpServers` JSON above. On Windows, clients that cannot directly spawn `npx` can use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "github:yong6330/google-flow-browser-mcp"]`.

The browser adapter is pinned to `playwright-core` 1.56.1 to preserve Node 18 support; newer releases require Node 20. System-browser compatibility still needs live checks.

For a local checkout:

```sh
npm install
npm test
npm run doctor
npm start
```

`npm start` speaks MCP on stdout; diagnostics go to stderr. It does not launch Chrome until requested. Doctor works without login and does not launch Chrome.

## Configuration (optional)

Precedence: supported tool argument → `FLOW_MCP_*` environment variable → user JSON config → default. Unknown config keys warn on stderr; invalid values stop startup. An explicit `confirm: false` overrides the deprecated `auto_confirm: true` alias.

Config file: `$FLOW_MCP_CONFIG`, or:

| Platform | Default                                                                                    |
| -------- | ------------------------------------------------------------------------------------------ |
| macOS    | `~/Library/Application Support/google-flow-mcp/config.json`                                |
| Windows  | `%APPDATA%\google-flow-mcp\config.json`                                                    |
| Linux    | `$XDG_CONFIG_HOME/google-flow-mcp/config.json`, or `~/.config/google-flow-mcp/config.json` |

| Config key            | Environment variable             | Default / meaning                                                                  |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| `home`                | `FLOW_MCP_HOME`                  | `~/.google-flow-mcp` (absolute path)                                               |
| `chromePath`          | `FLOW_MCP_CHROME_PATH`           | Automatic system browser discovery; `flow_connect` override                        |
| `flowUrl`             | `FLOW_MCP_FLOW_URL`              | `https://labs.google/fx/tools/flow`                                                |
| `expectedAccount`     | `FLOW_MCP_EXPECTED_ACCOUNT`      | Unset; report email if available. If set, require a match; `flow_connect` override |
| `cdpPort`             | `FLOW_MCP_CDP_PORT`              | `9222`; choose a free port if occupied; `flow_connect` override                    |
| `headless`            | `FLOW_MCP_HEADLESS`              | `false`; use visible first-run sign-in; `flow_connect` override                    |
| `maxConcurrentJobs`   | `FLOW_MCP_MAX_CONCURRENT_JOBS`   | `1`, allowed `1`–`3`                                                               |
| `creditFloor`         | `FLOW_MCP_CREDIT_FLOOR`          | `0`; paid tool argument override                                                   |
| `jobTimeoutMs`        | `FLOW_MCP_JOB_TIMEOUT_MS`        | `600000`                                                                           |
| `pollIntervalMs`      | `FLOW_MCP_POLL_INTERVAL_MS`      | `5000`                                                                             |
| `downloadWaitMs`      | `FLOW_MCP_DOWNLOAD_WAIT_MS`      | `300000`                                                                           |
| `idempotencyWindowMs` | `FLOW_MCP_IDEMPOTENCY_WINDOW_MS` | `86400000` (24 hours)                                                              |
| `uiStrings`           | `FLOW_MCP_UI_STRINGS`            | `{}`; language → key → string/string array; env value is JSON                      |

Boolean environment values must be `true` or `false`. Config examples: [config/flow.config.example.json](config/flow.config.example.json). Only options advertised in a tool's schema can be overridden per call.

Data lives under `home`: `profile/`, `outputs/`, `logs/`, `state/`, `screenshots/`, `temp/`. Screenshots are taken only on explicit request. Downloads use `outputs/`, or an absolute per-call `output_folder`. The server never writes to the current directory or the user's Downloads folder by default. A separate profile is created from scratch; your regular browser profile is never read or copied.

Files remain until you clean them. `flow_cleanup` defaults to a preview and covers only logs, screenshots, and temp files older than `older_than_days` (default 7). Use `confirm: true` to remove them. It excludes profiles, outputs and job state. Keep state files to preserve duplicate-submission protection. Use one server per home; multiple clients need separate homes and separate sign-ins.

## Tools

All tools validate arguments and expose JSON schemas via MCP `tools/list`. Asset matches accept `key`, or an exact `caption` plus `prompt`, or an inventory `index`. Re-list after mutations. Exact duplicate caption/prompt cards are deliberately refused when they cannot be distinguished safely.

| Tool                                                                       | Arguments / behavior                                                                                                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow_connect` / `flow_disconnect`                                         | Launch or attach owned CDP; detach without deleting profile                                                                                                                |
| `flow_status` / `flow_doctor`                                              | Connection, jobs / Node, browser path, profile, CDP, login, language, credits                                                                                              |
| `flow_account_check` / `flow_credits`                                      | Read account popover; optional expected-account check / balance                                                                                                            |
| `flow_projects`                                                            | `action: list\|open\|create`, `name` or `id`                                                                                                                               |
| `flow_list_assets`                                                         | `type: image\|video\|all`, `include_trashed`; scans the virtual grid, including both trash columns                                                                         |
| `flow_upload_media`                                                        | Absolute `paths[]`, `wait`; deduplicate by file name and confirm ingestion; returns a job                                                                                  |
| `flow_generate_image`                                                      | `prompt`, `model`, `ratio`, `quantity` 1–4, `reference_images[]` (existing asset names)                                                                                    |
| `flow_generate_video`                                                      | `prompt`, `mode: text\|frames\|ingredients`, `start_image`, optional `end_image`, or `reference_images[]`; model, duration 4/6/8/10, resolution 360p/720p, ratio, quantity |
| `flow_rename_asset`                                                        | `match`, `name`; verify the opened caption field before typing                                                                                                             |
| `flow_trash_assets` / `flow_restore_assets`                                | `matches[]`, dry run unless `confirm: true`; no permanent-delete tool                                                                                                      |
| `flow_download_asset`                                                      | `match`, `quality: 270p-gif\|720p\|1080p`, `output_folder`; 1080p routes through paid upscale safeguards                                                                   |
| `flow_upscale_download`                                                    | `asset_names[]`, `resolution: 1080p\|4k`, `confirm`, `allow_4k`, `wait`, optional `compare_with` absolute local file                                                       |
| `flow_download_latest`                                                     | Compatibility alias: inventory the first asset, then download it safely                                                                                                    |
| `flow_screenshot`                                                          | Optional `name`; short timeout plus CDP fallback                                                                                                                           |
| `flow_cleanup`                                                             | `older_than_days`, dry run unless `confirm: true`                                                                                                                          |
| `flow_job_status` / `flow_job_cancel`                                      | `job_id`; status optionally accepts `wait: true`; cancel stops local work only                                                                                             |
| `flow_queue_status`                                                        | Recent persisted jobs, optional `history_limit`                                                                                                                            |
| `flow_create_character` / `flow_import_character` / `flow_open_characters` | Stage character or import JSON / inspect section                                                                                                                           |
| `flow_create_scene`                                                        | Stage `prompt` and optional `characters[]`                                                                                                                                 |
| `flow_open_tools_gallery` / `flow_use_tool`                                | Inspect gallery / open exact `tool_name`, stage named text `params`                                                                                                        |
| `flow_use_grid_architect`                                                  | Stage `theme_prompt`, `shot_prompts[]`, engine, ratio, visual logic, local references                                                                                      |
| `flow_discover_ui`                                                         | Inspect current page; no automatic selector-map rewriting                                                                                                                  |

Generation tools can open a specified `project_id` or `project_name`; otherwise open a project first. Character/scene/grid staging also returns a job and accepts `wait`. Characters/scenes/grid/gallery retain their original tool names and remain staging/discovery workflows. Unknown or ambiguous controls produce errors instead of success guesses.

## Credits, jobs, parallelism, downloads

Image/video generation and upscale **default to dry run**. A dry run stages settings and returns a job containing the cost read from Flow. Only `confirm: true` (or deprecated `auto_confirm: true`) authorizes the paid click. If cost, balance, mode, or settings cannot be verified, paid submission stops. Upscale cost visibility is unverified; if Flow does not show it, this version deliberately blocks that paid action.

Long jobs return `id` (batch non-waiting responses use `job_id`). Use `wait: false` for background work, then `flow_job_status`. The queue persists settings, pre-submit inventory and a write-ahead submission intent. After reconnecting following a restart it resumes polling, never re-clicks Generate. Results with ambiguous identity or uncertain submission require manual review. Identical project + prompt + frames + settings requests reuse a job within the configured window; `force: true` explicitly bypasses that protection. Never use force merely because polling timed out.

Recommend **at most three** concurrent jobs; Flow warns against many simultaneous upscales. Default concurrency is one. Set two or three only after checking stability. Batch upscale reduces to one after an error and never automatically retries a paid submission. Credit reservations are conservative: uncertain jobs continue reserving their cost. Cancellation cannot cancel a generation already running at Google or promise a refund.

**Verify the 1080p result and get the user's OK before 4K; never chain 1080p and 4K.** 4K requires both `confirm: true` and `allow_4k: true`.

Outputs keep their sparkle watermark. ZIP downloads preserve Unicode names, never extract archive paths directly, and use unique local filenames. `ffprobe` is optional: when available, video size, codec, duration and requested minimum resolution are checked. SHA-256 and file size are always reported. Optional `compare_with` uses `ffmpeg` SSIM on aligned scaled frames; this is a similarity aid, not proof of asset identity or creative acceptance.

## Languages

| Language        | Status                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| Korean (`ko`)   | Labels grounded in [field-tested notes](docs/FLOW_UI_NOTES.md); new workflows still require live verification |
| English (`en`)  | Best effort, `_verified: false`                                                                               |
| French (`fr`)   | Best effort, `_verified: false`                                                                               |
| Japanese (`ja`) | Best effort, `_verified: false`                                                                               |

Lookup prefers structural/role/aria/icon controls, then the detected dictionary, then other dictionaries. Detection uses HTML language or known labels. Unsupported languages can add overrides via `uiStrings` without modifying code.

To contribute a language, copy a file in `src/ui/strings/`, translate labels and numeric patterns, keep `_verified: false`, register it in `src/ui/strings.js`, and add offline fallback tests. Validate in a real signed-in UI before marking individual facts verified. Keep selectors/icons under `src/ui/`; append justified corrections to the UI notes rather than replacing evidence.

## Troubleshooting and manual checks

- **Crashpad / sandbox startup crash:** run `node scripts/start-browser.mjs` in a normal terminal outside the sandbox, sign in manually, then call `flow_connect` to attach. Do not weaken browser security or use your regular profile.
- **Port in use:** unrelated processes are never killed or attached. The launcher picks another free local port. Only the dedicated profile's matching CDP marker is reused. If that profile is open without CDP, close its window and rerun the launcher.
- **Login/captcha/verification:** complete it manually in the dedicated visible window, then retry connection. The server never types credentials or bypasses checks.
- **Language or selector mismatch:** use `flow_discover_ui`, inspect the exact control labels, extend `uiStrings`. A missing setting stops the paid click.
- **Account mismatch:** `expectedAccount` is optional. When set, inability to read the exact signed-in email is also a blocking error.
- **Missing download after restart:** download events may not survive process loss. The job waits for an event without re-clicking the paid option; inspect the asset manually if none arrives. No regeneration is attempted.

Offline gates: `npm test`, `npm run doctor`, and `node --check` on JavaScript files. Manual live smoke (not part of tests):

```sh
node scripts/live-smoke.mjs --help
node scripts/live-smoke.mjs
node scripts/live-smoke.mjs --project PROJECT_ID --prompt "A ceramic cup"
# Only after reviewing the staged settings/cost and explicitly approving spending:
node scripts/live-smoke.mjs --project PROJECT_ID --prompt "A ceramic cup" --spend --download
```

The default script never spends credits. Use a signed-in dedicated profile, run only one MCP process for that home, and inspect the [architecture checklist](docs/ARCHITECTURE.md#live-verification-checklist) before accepting this as production-ready.

## Safety and responsibility

Use only an account you are authorized to operate and comply with Google's terms and applicable rules. You are responsible for prompts, generated content, subscriptions and credit spending. Do not remove or cover Flow's sparkle watermark. Never share the profile directory, cookies or job/log files containing sensitive prompts. There is no telemetry. No credential entry, verification bypass, permanent deletion, or unrelated-tab manipulation is offered.

## 한국어 안내

Node.js 18 이상과 Chrome/Chromium/Edge가 필요합니다. `flow_connect`로 전용 브라우저를 열고 처음 한 번 직접 로그인하세요. 일반 Chrome 프로필을 읽거나 복사하지 않습니다. 이미지·영상 생성과 업스케일은 기본적으로 준비만 하며, 비용과 설정을 확인한 뒤 `confirm: true`를 전달해야 결제 동작을 실행합니다. 4K는 1080p 결과 확인과 사용자 동의 후 `allow_4k: true`도 필요합니다. 새 구현은 로그인된 실제 Flow에서 아직 검증하지 않았으므로, 오프라인 테스트 통과를 실제 생성 성공으로 해석하지 마세요.
