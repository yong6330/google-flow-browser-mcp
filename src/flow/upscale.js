import { config } from "../utils/config.js";
import { workerPage } from "../browser/connect.js";
import { ensureProject } from "./projects.js";
import { openAsset } from "./assets.js";
import { executePaid } from "./paid-action.js";
import { accountInfo } from "./account.js";
import { downloadMenu, qualityOption } from "../ui/assets.js";
import { guard, settingsPanel } from "../ui/actions.js";
import { parseNumber, detectLanguage } from "../ui/strings.js";
import { jobQueue } from "../queue/job-queue.js";
import { saveDownload, verifyFile } from "./files.js";
export async function upscale(
  main,
  args,
  { job: parent, signal: parentSignal } = {},
) {
  if (args.resolution === "4k" && !args.allow_4k)
    throw new Error(
      "4K requires allow_4k:true. Verify the 1080p result and get the user's OK before 4K; never chain 1080p and 4K.",
    );
  const project = await ensureProject(main, args);
  const projectUrl = project.url;
  const jobs = [];
  // Adaptive batches: queue capacity is the upper bound; after any failure downgrade to one. Never retry a paid click.
  let concurrency = Math.min(config.maxConcurrentJobs, 3);
  for (let offset = 0; offset < args.asset_names.length;) {
    parentSignal?.throwIfAborted();
    const batch = args.asset_names.slice(offset, offset + concurrency);
    offset += batch.length;
    for (const name of batch) {
      const payload = { ...args, asset_names: undefined, asset_name: name };
      const job = jobQueue.submit(
        "upscale",
        payload,
        async (job, signal) => {
          const page = await workerPage(projectUrl, { signal });
          try {
            await openAsset(page, args.match || { caption: name });
            await guard(page);
            const account = await accountInfo(page);
            await downloadMenu(page);
            const option = await qualityOption(page, args.resolution);
            // UNVERIFIED-LIVE: upscale menu must display a readable credit cost. Missing cost blocks paid submission.
            const cost = parseNumber(
              await (await settingsPanel(page)).innerText(),
              "costPattern",
              await detectLanguage(page),
            );
            if (!args.confirm)
              return {
                dry_run: true,
                asset: name,
                resolution: args.resolution,
                cost,
                credits: account.credits,
                note:
                  cost === null
                    ? "Flow did not expose a credit cost; paid submission is blocked unless accept_unknown_cost:true (field-tested: 1080p upscales showed no cost and did not change the balance)."
                    : undefined,
              };
            await page.keyboard.press("Escape");
            const { download } = await executePaid({
              queue: jobQueue,
              job,
              signal,
              floor: args.creditFloor ?? config.creditFloor,
              metadata: { projectUrl, detailUrl: page.url() },
              readBalance: async () => {
                await guard(page);
                return (await accountInfo(page)).credits;
              },
              prepare: async () => {
                await downloadMenu(page);
                const cost = parseNumber(
                  await (await settingsPanel(page)).innerText(),
                  "costPattern",
                  await detectLanguage(page),
                );
                const option = await qualityOption(page, args.resolution);
                // Unknown cost is allowed only when the caller opts in; the balance check and creditFloor still apply.
                const effectiveCost =
                  cost === null && args.accept_unknown_cost ? 0 : cost;
                return {
                  cost: effectiveCost,
                  submit: async () => {
                    const download = page.waitForEvent("download", {
                      timeout: config.downloadWaitMs,
                    });
                    download.catch(() => {});
                    await option.click();
                    return { download };
                  },
                };
              },
            });
            const files = await saveDownload(
              await download,
              args.output_folder,
            );
            signal.throwIfAborted();
            return {
              files: await Promise.all(files.map((f) => verifyFile(f, args))),
            };
          } finally {
            await page.close().catch(() => {});
          }
        },
        {
          force: args.force,
          dedupe: args.confirm,
          keyData: {
            project: projectUrl,
            asset: args.match || name,
            resolution: args.resolution,
          },
        },
      );
      jobs.push(job);
      if (parent)
        jobQueue.update(parent.id, { childIds: jobs.map((j) => j.id) });
    }
    // For non-waiting calls the shared queue still enforces the cap; adaptive scheduling runs in the background.
    const completed = await Promise.all(
      jobs.slice(-batch.length).map((j) => jobQueue.wait(j.id)),
    );
    if (completed.some((j) => j.status !== "completed")) concurrency = 1;
  }
  return jobs.map((j) => jobQueue.get(j.id));
}
