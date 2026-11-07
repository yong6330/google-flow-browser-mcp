# Architecture

## Boundaries

`src/index.js` owns the MCP stdio transport. `src/tools/registry.js` owns validated Zod schemas and dispatch. Tool JSON schemas come from those same validators using the bundled Zod v3 compatibility API; the installed Zod package is v4. No schema is maintained twice.

`src/utils/config.js` resolves optional platform user config and environment overrides. Nothing resolves data relative to the package or process working directory. `src/browser/connect.js` discovers and spawns an installed browser, verifies the dedicated profile's CDP endpoint, and provides isolated worker tabs. `src/ui/` owns DOM selectors, icon ligatures, dictionaries, language detection and UI actions. `src/flow/` composes those operations into projects, inventory, generation, downloads, account checks and retained legacy staging tools.

No telemetry or remote control service is used. Logs go to stderr and the data logs directory, never stdout. Prompts and signed-in account information can appear in state and diagnostics: treat the entire data directory as private. Credentials are never entered, exported or copied.

## Browser ownership and isolation

The data home is an absolute path, defaulting to `~/.google-flow-mcp`. Chrome gets only its dedicated `profile/`. A matching DevToolsActivePort port + browser endpoint marker proves which dedicated instance can be reused; a random service responding on the preferred port is not enough. An occupied unowned port causes free-port selection. No processes or unrelated tabs are killed. Browser launch is detached; disconnect releases the CDP connection and preserves the browser and profile. The browser must run in the user's normal desktop environment if a sandbox blocks Crashpad.

Only Flow URLs are accepted for operations. An existing non-Flow tab is never selected as a fallback. Workers are newly created tabs. Dry-run staging keeps at most three worker tabs for inspection; older staged worker tabs are closed. These are server-created Flow tabs. A profile-wide server lock prevents two MCP processes racing in the same data directory. Separate data homes intentionally have independent state and duplicate protection.

## Configuration and language

Precedence is supported tool argument → prefixed env → JSON file → defaults. Invalid config stops startup; absent config is normal. Unknown file keys warn. Platform resolution can be injected in offline tests. There are no runtime writes to package config files.

Structural/icon controls are attempted first, then exact role names from the detected dictionary, then every dictionary. HTML lang is preferred; known unique labels are the fallback. Overrides can replace a translation or supply an array of alternatives. `en`, `fr`, `ja` have `_verified: false`. Korean labels come from the preserved UI notes; that evidence does not validate the new orchestration code.

Selectors and labels are centralized under `src/ui/`. Unreadable settings, ambiguous controls, truncated asset captions or mismatched rename fields produce errors. There is no automatic guessed selector update. Discovery reports current controls for a human to review.

## Asset identity

Inventory walks the virtual scroller in 350 px increments until scrollTop stops changing, rather than estimating counts from height. A stable key is the caption plus a SHA-256 prompt hash. Signed thumbnail URLs are neither keys nor download addresses. Screen top and left distinguish the two trash columns during traversal. Inventory indices are snapshot hints: mutations re-resolve stable keys, and exact indistinguishable duplicate cards are refused.

Metadata is read from card DOM attributes or visible metadata nodes. Missing prompt/model/duration/resolution/created information is `null`; it is never invented. A missing prompt also means generation completion cannot be safely correlated and polling will require review. After rename/trash/restore the page reloads to avoid stale captions. Only reversible per-tile trash and restore controls exist; permanent deletion is not exposed.

## Paid actions and durable jobs

The default is staging with no paid click. `confirm` overrides `auto_confirm` when supplied. Before a paid action, settings, selected mode and model are re-read, account balance and cost must be numeric, and credit-floor checks account for outstanding uncertain reservations. `executePaid` serializes balance checks and writes a submission intent to an fsynced temporary file, atomically renamed into state, **before** invoking the paid click. It never retries that click. This prioritizes avoiding duplicate charges over automatic recovery from an ambiguous failure.

A job has queued/running/completed/failed/cancelled/recovering/needs_review states. Maximum active worker count defaults to one, configurable up to three. A batch coordinator occupies no worker slot; its child upscales share the same queue as generations. Batch concurrency drops to one after failure; no automatic paid retries occur. Cancellation is local and propagates to queued children. It cannot stop Google's already-submitted work.

Idempotency hashes canonical project + prompt + frames/references + settings; output folder, confirmation, wait and download preferences do not change a paid generation's identity. Upscale identity includes project, asset and resolution. The default window is 24 hours. `force` is the only automatic-duplicate override. Dry runs do not suppress later confirmations. A single server owns a home; distinct homes/accounts do not share a global ledger.

On restart, unfinished jobs with paid intent become recovering. The original submit closure is never replayed. `flow_connect` attaches the browser, verifies access, then schedules polling recovery. Unsubmitted queued work becomes needs_review instead of being silently launched after restart. Generation polling compares exact prompt and pre-submit inventory, requires the requested count of ready cards and refuses ambiguous results. Same prompt/caption already in the baseline may prevent automatic correlation; that becomes a manual review rather than a false success.

Upscale recovery listens for a new browser download event without clicking an upscale option. Some browser rollouts do not replay an event into a newly attached tab. In that case the job becomes needs_review and continues to reserve its estimated cost; inspect Flow and recover the existing result manually. This implementation does not claim server-side cancellation or exactly-once delivery guarantees from Google. It guarantees that its persisted recovery path does not automatically resubmit an uncertain paid operation.

## Files and retention

Default writes are restricted to profile, outputs, logs, state, screenshots (only on request) and temp under data home. An absolute `output_folder` overrides outputs. Downloads are captured before the click and saved to owned paths with unique safe names; saveAs retries ENOENT. ZIP extraction uses a cross-platform library, preserves Unicode, ignores archive directory paths and refuses more than 512 MiB expanded data. Archives are retained alongside extracted media. It never extracts into the user's Downloads folder.

Video verification uses ffprobe when available: nonempty file, hash, codec, dimensions, duration and minimum upscale resolution. Without ffprobe it reports file size/hash and the missing media verification. Optional ffmpeg SSIM compares aligned scaled frames and reports a score; this does not establish creative acceptance or substitute for exact identity checks. Watermarks are untouched.

`flow_cleanup` previews by default and traverses only logs/screenshots/temp, ignores symlinks, and removes old regular files only after `confirm`. It never removes profiles, state or outputs. No automatic retention deletion exists.

## Tests and manual smoke

`npm test` is offline and launches no browser. It covers config/env/argument precedence, mocked platform paths and browser discovery, language fallback, credit-floor safety, canonical identities, queue bounds/persistence/recovery, JSON schemas, safe ZIP/ENOENT handling, and a real MCP stdio initialize + tools/list handshake. Mocked tests establish local contracts; they are not evidence that Flow currently renders the expected DOM.

`npm run doctor` needs no login. It reports the installed browser, Node, profile write access and CDP availability. Login/language/credits remain uninspected until a connection exists. `scripts/live-smoke.mjs` is manual and stages by default; only `--spend` authorizes generation. `playwright-core` is pinned to 1.56.1: the newer 1.63 adapter rejects Node 18 at runtime. Node 18 compatibility is checked with an actual Node 18 test process. No MCP resources/prompts are exposed because they add no necessary functionality to the requested tools.

## Live verification checklist

Items marked [x] were checked with dry runs on a signed-in Korean account in November 2026. Everything else remains unverified against a signed-in account. `// UNVERIFIED-LIVE` comments identify these boundaries in source. Use a dedicated test project, inspect every dry run, and authorize each paid action explicitly.

- [ ] macOS, Windows and Linux detached system-browser launch, owned-CDP reuse, busy-port handling, default-profile refusal and sandbox Crashpad diagnostics.
- [x] Account panel email and credit parsing on a PRO account (ko).
- [ ] First-run visible sign-in, challenge detection in each language, optional email verification and credit parsing on other tiers.
- [x] Project list and open by name; nav scoping on the deployed layout.
- [ ] Project create and name persistence.
- [x] Image/video mode and model selection (Omni 1.2 Flash, Omni 1.1 Flash, Veo 3.1 Lite, Nano Banana 2.1), ratio, quantity, resolution, length slider and buttons, and the cost footer in dry runs.
- [ ] Agent toggle; other models.
- [ ] Text video has no stale frame attachments; frame start/end attachment and optional end clearing; ingredients search, exact names and reference clearing.
- [ ] Upload chooser interception, filename dedupe and ingestion readback for all supported media kinds.
- [x] Virtual-grid listing of a populated project (captions, kind, resolution).
- [ ] Duplicate captions, prompt and metadata extraction, both trash columns, caption staleness after mutations.
- [ ] Rename refusal on project-title fields; reversible per-tile trash/restore without interacting with toast navigation or permanent deletion.
- [ ] Paid image/video exactly one click after confirmation, credit-floor reservation under concurrent workers, failure cards, completion correlation and cancellation.
- [ ] Crash/restart between intent/click/result; polling recovery without a second paid click, including identical existing prompts.
- [ ] GIF/original download events, ZIP Unicode filenames and ENOENT recovery; verify actual selected asset by hash when needed.
- [ ] Upscale cost visibility in the menu. If no cost is visible the paid upscale stays blocked unless the caller passes `accept_unknown_cost:true` (field note: 4 s 1080p upscales showed no cost and left the balance unchanged); the balance must still be readable and above `creditFloor`. Compare the balance before/after on a real account.
- [ ] 1080p upscale automatic download, 2–3 worker tabs, downgrade after errors, interrupted event recovery and minimum-dimension checks.
- [ ] Separate explicit 4K authorization after user approval of 1080p; no automatic quality chaining.
- [ ] ffprobe metadata checks and optional ffmpeg SSIM across real codecs and durations; physical/creative acceptance remains a human check.
- [ ] Hang-safe screenshot fallback on grids with many video tiles.
- [ ] Legacy characters, import, scenes, tools gallery, generic tool forms and Grid Architect settings/reference staging. These layouts have no current field-tested evidence.
- [ ] English/French/Japanese exact strings and known-label language detection; other-language config extensions.

## Implementation decisions and remaining gates

- Dedicated user profile replaces all regular-profile reuse. Configuration is optional; account matching is optional and fail-closed when requested.
- The browser adapter is pinned to the last selected Node 18-compatible release instead of inheriting a dependency that silently requires Node 20. The system browser is still discovered; no bundled browser is downloaded.
- Original duplicated tool implementations were replaced by a schema registry and shared flow/UI helpers. Original tool names remain callable.
- 1080p download is routed through upscale safeguards because the field-tested notes say it starts server-side upscale work.
- Missing cost or uncertain identity blocks spending. Automated recovery can remain pending/needs_review when the browser cannot expose a reliable result.
- New resources/prompts were skipped. No skill files were created or changed. Flow UI notes and LICENSE were preserved.
- Requested phased Git commits could not be created: this task environment makes `.git` read-only, and Git rejected `index.lock` creation. No permission workaround, remote operation, push, reset or forced operation was used. Changes remain in the working tree for a writable environment to review and commit.
