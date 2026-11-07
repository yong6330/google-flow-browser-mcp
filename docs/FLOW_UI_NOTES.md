# Google Flow UI notes (field-tested)

Facts learned while running a 30-clip production through Flow with browser automation. Verified in the **Korean** UI (`ko`) in October 2026; English/French/other labels are best-effort and must be confirmed. Flow's DOM changes without notice — prefer role/aria/structure over text, keep every selector in one module, and fail loudly instead of guessing.

## URLs
- Landing / tools: `https://labs.google/fx/tools/flow` (locale-neutral; do not hardcode `/fr/`).
- Project: `https://flow.google.com/project/<projectId>`; sections: `/character`, `/trash`; media detail view: `/project/<projectId>/edit/<mediaId>`.
- A card is opened by clicking its thumbnail; the detail view has the title field, a download button and a delete button.

## Project page layout
- Left nav: All media · Images · Videos · Characters · Scenes · Uploads · Tools · Trash. (ko: 전체 미디어 · 이미지 · 동영상 · 캐릭터 · 장면 · 업로드 · 도구 · 휴지통.) The "Videos" nav item filters the grid, but the text also appears in the prompt-bar chip, so click the nav entry, not the first text match.
- The grid is a **virtual scroller**: `.cdk-virtual-scrollable.page-container`. Only visible rows exist in the DOM. Scroll `scrollTop` in steps (~300–400 px) and collect tiles; stop when `scrollTop` stops changing. Do not trust `scrollHeight / rowHeight` as an item count.
- Tiles are `flow-grid-tile-container` elements. `aria-label` = the card **caption** (auto-generated from the prompt, or the name you set). The caption can be truncated with `…`.
- **Duplicate captions are common.** Identify cards by caption + the prompt text shown in the row, and verify downloads by SHA-256 when it matters.
- The thumbnail `img.src` is a **signed URL that changes per load** — never use it as an identifier.
- In the **Trash** view the grid has **two tiles per row**; deduplicate by `(top, left)`, not by `top` alone, or half of the items are missed. Each trash tile has its own `restore` and `delete permanently` buttons (ko: 복원, 완전히 삭제).
- Each card row has icon buttons (icon ligature text): `download`, `undo` (reuse prompt), `delete` (move to trash).
- After renaming or trashing, the grid caption may be **stale until the page is reloaded**. Re-read in a fresh navigation before concluding that an action failed.

## Prompt bar
- Collapsed chip like `Video · 720p · 8s · x1` opens the settings popover: Image/Video tabs; **Frames** vs **Ingredients** sub-mode (ko: 프레임 / 소재); aspect (16:9, 9:16); model dropdown (e.g. `Omni 1.1 Flash`, Veo 3.1 variants, Nano Banana Pro/2, Imagen 4); resolution (360p / 720p); duration buttons (4/6/8/10 s); quantity x1–x4; a footer line that states the **credit cost** (ko: `생성 시 12 크레딧이 사용됩니다`). Read it before generating.
- **Frames mode** exposes `Start` and `End` slots (ko: 시작/종료). Clicking a slot opens an asset picker (search box + list); choosing an item attaches it. Using an end frame is the most reliable way to force a motion direction (e.g. which way a door opens).
- Ingredients mode: the `+` button opens the asset picker (also has an "upload media" entry that opens a native file chooser — use Playwright's `filechooser` event).
- Generate = the arrow button (aria-label ko: 생성 시작). Generation is asynchronous: the new card appears at the top of the grid while rendering.
- Type prompts with `keyboard.insertText` after focusing the prompt box (placeholder text ko: `무엇을 만들고 싶으신가요?`); `fill()` is unreliable on this contenteditable.

## Download / upscale
- In the detail view the download button opens a menu: `270p animated GIF`, `720p original size`, `1080p upscaled`, `4K upscaled` (4K may require a plan upgrade).
- Choosing 1080p starts an upscale job on the server (toast: "upscaling… may take a few minutes… avoid starting several upscaling jobs"). In practice a 4 s clip finished in ~30 s and **the browser download started by itself** when rendering completed. Three concurrent upscales (three tabs) worked without errors.
- Listen for Playwright's `download` event **before** clicking, then `download.saveAs(<your own dir>)`. The suggested file name has the form `<Caption>_1080p_<yyyymmddhhmmss>.mp4`. Some paths deliver a `.zip` containing a single MP4 with a non-ASCII name — extract with `ditto -x -k` (macOS) / a zip library, not `unzip`.
- Playwright may throw `ENOENT` on the temporary download path; saving with `saveAs` to a directory you own and retrying the same card (not regenerating) fixes it.
- Never leave downloads in the user's Downloads folder; use the MCP data/output directory.
- All outputs carry a visible sparkle watermark in the lower-right corner (AI-provenance mark). Do not remove or cover it.

## Rename
- Open the card (detail view) and edit the title input (`input.editable-text-input`, top-left). The same CSS class is also used by the project title on the grid, so **refuse to type unless the field currently holds the caption you opened**.

## Trash
- Row button `delete` moves a card to Trash and shows a toast with `Undo` / `View in trash` / `Close`. **Do not click a generic text match like "trash" after deleting** — it hits "View in trash" and navigates away.
- Restore from the Trash view with the tile's own restore button. Never empty the trash automatically.

## Screenshots
- `page.screenshot()` can hang for 30–90 s on pages with many `<video>` tiles (waiting for fonts/compositing). Use a short timeout, take screenshots in the detail view, or use CDP `Page.captureScreenshot`.

## Account / credits
- The avatar/plan chip (e.g. `PRO`) opens an account popover that shows the signed-in email and a line like `Google Flow credits N`. Daily free credits are spent first.

## Sandbox / runtime
- Chrome fails to start with a Crashpad permission error inside restricted sandboxes (macOS `bootstrap_check_in … Permission denied`). Launch Chrome from the user's normal environment, then attach over CDP.
- Chrome refuses `--remote-debugging-port` on the **default** profile directory; always use a dedicated `--user-data-dir`.
