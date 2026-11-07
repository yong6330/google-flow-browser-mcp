import { config } from "../utils/config.js";
import { openAsset } from "./assets.js";
import { downloadMenu, qualityOption } from "../ui/assets.js";
import { saveDownload, verifyFile } from "./files.js";
import { guard } from "../ui/actions.js";
export async function downloadAsset(page, args, { opened = false } = {}) {
  if (args.quality === "1080p")
    throw new Error(
      "1080p starts a paid upscale. Use flow_upscale_download with confirm:true after reviewing the dry run.",
    );
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!opened || attempt) await openAsset(page, args.match);
      await guard(page);
      await downloadMenu(page);
      const option = await qualityOption(page, args.quality);
      // UNVERIFIED-LIVE: retry only the same existing card on ENOENT, never a generation or upscale click.
      const event = page.waitForEvent("download", {
        timeout: config.downloadWaitMs,
      });
      event.catch(() => {});
      await option.click();
      const files = await saveDownload(await event, args.output_folder);
      return {
        files: await Promise.all(files.map((file) => verifyFile(file))),
      };
    } catch (e) {
      if (attempt === 2 || !e.message.includes("ENOENT")) throw e;
      await page.keyboard.press("Escape");
    }
  }
}
