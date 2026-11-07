// UNVERIFIED-LIVE: browser-facing paths require the signed-in checks in docs/ARCHITECTURE.md.
import { selectors as S } from "./selectors.js";
import { unique, click } from "./actions.js";
import { detectLanguage, matches } from "./strings.js";
export async function visibleTiles(page) {
  // UNVERIFIED-LIVE: metadata DOM differs by rollout. Missing metadata is null, never inferred from signed URLs.
  return page.locator(S.tiles).evaluateAll(
    (els, s) =>
      els
        .map((e, index) => {
          const rect = e.getBoundingClientRect();
          const read = (key) => {
            const n = e.querySelector(s[key]);
            return (
              n?.getAttribute(
                `data-${key === "promptText" ? "prompt" : key}`,
              ) ||
              n?.textContent?.trim() ||
              null
            );
          };
          const prompt = read("promptText");
          return {
            caption: e.getAttribute("aria-label") || "",
            prompt,
            kind: e.querySelector("video")
              ? "video"
              : e.querySelector("img")
                ? "image"
                : "unknown",
            model: read("model"),
            duration: read("duration"),
            resolution: read("resolution"),
            created:
              e.querySelector(s.created)?.getAttribute("datetime") ||
              read("created"),
            top: rect.top,
            left: rect.left,
            domIndex: index,
            ready:
              !!e.querySelector("video, img") && !e.querySelector(s.progress),
            text: e.innerText || "",
          };
        })
        .filter((e) => e.caption),
    S,
  );
}
export async function scrollGrid(page, top) {
  const s = await unique(page.locator(S.scroller), "media virtual scroller");
  return s.evaluate((el, t) => {
    const before = el.scrollTop;
    el.scrollTop = t === null ? before + 350 : t;
    return { before, after: el.scrollTop };
  }, top);
}
export async function tileLocator(page, index) {
  return page.locator(S.tiles).nth(index);
}
export async function openTile(page, index) {
  const tile = await tileLocator(page, index);
  await (await unique(tile.locator(S.thumbnail), "asset thumbnail")).click();
  await page.waitForURL(/\/edit\//, { timeout: 10000 });
}
export async function tileAction(page, index, action) {
  const tile = await tileLocator(page, index);
  await click(page, action, { scope: tile });
}
export async function renameOpened(page, caption, name) {
  if (!/\/edit\//.test(new URL(page.url()).pathname))
    throw new Error("Not in asset detail view");
  const input = await unique(page.locator(S.title), "asset caption field");
  if ((await input.inputValue()).trim() !== caption.trim())
    throw new Error(
      "Caption field does not hold the opened caption; refusing to type.",
    );
  await input.fill(name);
  await input.press("Enter");
  if ((await input.inputValue()).trim() !== name)
    throw new Error("Rename did not persist");
}
export async function tileState(page, tile) {
  const lang = await detectLanguage(page);
  if (matches(tile.text, "failurePattern", lang)) return "failed";
  return tile.ready && !matches(tile.text, "busyPattern", lang)
    ? "ready"
    : "pending";
}
export async function uploadFiles(page, files) {
  await click(page, "addIngredient");
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
  chooserPromise.catch(() => {});
  await click(page, "upload");
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  await page.keyboard.press("Escape");
}
export async function downloadMenu(page) {
  await click(page, "download");
}
export async function qualityOption(page, quality) {
  const pattern =
    quality === "270p-gif"
      ? /270p.*GIF/i
      : quality === "4k"
        ? /4\s*K/i
        : new RegExp(`\\b${quality}\\b`, "i");
  return unique(
    page.locator(S.options).filter({ hasText: pattern }),
    `download ${quality}`,
  );
}
