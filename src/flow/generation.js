import { config } from "../utils/config.js";
import { workerPage, keepStagedPage } from "../browser/connect.js";
import { ensureProject, projectId } from "./projects.js";
import { scanAssets } from "./assets.js";
import { executePaid } from "./paid-action.js";
import { renameAsset } from "./assets.js";
import { accountInfo } from "./account.js";
import {
  stageSettings,
  typePrompt,
  attachReferences,
  click,
  guard,
  settingsPanel,
} from "../ui/actions.js";
import { parseNumber, detectLanguage } from "../ui/strings.js";
import { visibleTiles, tileState, scrollGrid } from "../ui/assets.js";
import { jobQueue } from "../queue/job-queue.js";
import { downloadAsset } from "./download.js";
export async function stageGeneration(page, type, args) {
  await guard(page);
  await stageSettings(page, type, args);
  await page.keyboard.press("Escape");
  await typePrompt(page, args.prompt);
  await attachReferences(page, args);
  const account = await accountInfo(page);
  // Reopen settings and read the final cost after references have been attached.
  await stageSettings(page, type, args);
  const finalCost = parseNumber(
    await (await settingsPanel(page)).innerText(),
    "costPattern",
    await detectLanguage(page),
  );
  await page.keyboard.press("Escape");
  return { settings: args, cost: finalCost, ...account, dry_run: true };
}
export function generationIdentity(type, project, args) {
  return {
    type,
    project,
    prompt: args.prompt,
    frames: [args.start_image, args.end_image],
    references: args.reference_images || [],
    settings: {
      model: args.model,
      ratio: args.ratio,
      duration: args.duration,
      resolution: args.resolution,
      quantity: args.quantity,
      mode: args.mode,
    },
  };
}
export async function pollGeneration(page, job, signal, queue = jobQueue) {
  // UNVERIFIED-LIVE: correlate new cards by prompt plus pre-submit inventory; ambiguity never triggers another submission.
  const deadline = Date.now() + config.jobTimeoutMs;
  await page.goto(job.projectUrl, { waitUntil: "domcontentloaded" });
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    await guard(page);
    await scrollGrid(page, 0);
    const tiles = await visibleTiles(page);
    const candidates = tiles.filter(
      (t) =>
        t.prompt === job.payload.prompt &&
        !job.beforeKeys.includes(`${t.caption}:${t.prompt}`),
    );
    const ready = [];
    for (const tile of candidates) {
      const state = await tileState(page, tile);
      if (state === "failed")
        throw new Error(
          "Flow reports generation failure; inspect before forcing another paid attempt.",
        );
      if (state === "ready") ready.push(tile);
    }
    if (ready.length === job.payload.quantity) {
      const result = {
        assets: ready.map((t) => ({ caption: t.caption, prompt: t.prompt })),
        submitted: true,
      };
      if (job.payload.name) {
        if (result.assets.length !== 1)
          throw new Error("Automatic naming requires quantity:1");
        const original = result.assets[0];
        await renameAsset(page, { match: original, name: job.payload.name });
        result.assets[0] = { ...original, caption: job.payload.name };
      }
      if (job.payload.download)
        result.download = await downloadAsset(page, {
          match: result.assets[0],
          quality: "720p",
          output_folder: job.payload.output_folder,
        });
      return result;
    }
    if (ready.length > job.payload.quantity)
      throw new Error(
        "Multiple new results match this prompt. Manual review required.",
      );
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  throw new Error(
    "Polling timed out; no automatic resubmission. Reconnect to resume polling.",
  );
}
export async function generate(main, type, args) {
  const project = await ensureProject(main, args),
    projectUrl = project.url.split("/edit/")[0];
  const confirmed = args.confirm ?? args.auto_confirm ?? false;
  const job = jobQueue.submit(
    `generate_${type}`,
    { ...args, confirm: confirmed },
    async (job, signal) => {
      const page = await workerPage(projectUrl, { signal });
      let staged = false;
      try {
        const before = await scanAssets(page);
        signal.throwIfAborted();
        const setup = await stageGeneration(page, type, args);
        if (!confirmed) {
          await keepStagedPage(page);
          staged = true;
          return {
            ...setup,
            job_id: job.id,
            tab_url: page.url(),
            note: "Settings staged in a worker tab. Call again with confirm:true to spend credits.",
          };
        }
        await executePaid({
          queue: jobQueue,
          job,
          signal,
          floor: args.creditFloor ?? config.creditFloor,
          metadata: {
            projectUrl,
            beforeKeys: before.map((a) => `${a.caption}:${a.prompt}`),
          },
          readBalance: async () => {
            await guard(page);
            return (await accountInfo(page)).credits;
          },
          prepare: async () => {
            const text = await stageSettings(page, type, args);
            await page.keyboard.press("Escape");
            return { cost, submit: () => click(page, "generate") };
          },
        });
        return await pollGeneration(page, job, signal);
      } finally {
        if (!staged) await page.close().catch(() => {});
      }
    },
    {
      force: args.force,
      dedupe: confirmed,
      keyData: generationIdentity(type, projectId(projectUrl), args),
    },
  );
  return args.wait === false ? job : jobQueue.wait(job.id);
}
export async function resumeJob(job, signal) {
  const page = await workerPage(job.projectUrl, { signal });
  try {
    if (job.kind.startsWith("generate_"))
      return await pollGeneration(page, job, signal);
    // UNVERIFIED-LIVE: download events do not survive a process restart. Observe the detail page without re-clicking paid upscale options.
    if (job.kind === "upscale") {
      await page.goto(job.detailUrl, { waitUntil: "domcontentloaded" });
      const event = page.waitForEvent("download", {
        timeout: config.downloadWaitMs,
      });
      event.catch(() => {});
      signal.throwIfAborted();
      const download = await event;
      const { saveDownload, verifyFile } = await import("./files.js");
      const files = await saveDownload(download, job.payload.output_folder);
      return {
        files: await Promise.all(files.map((f) => verifyFile(f, job.payload))),
      };
    }
    throw new Error("Unknown recoverable job kind");
  } finally {
    await page.close().catch(() => {});
  }
}
