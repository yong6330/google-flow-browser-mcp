import { workerPage, keepStagedPage } from "../browser/connect.js";
import { ensureProject } from "./projects.js";
import { jobQueue } from "../queue/job-queue.js";
export async function workerJob(main, kind, args, run, { keep = false } = {}) {
  const project = await ensureProject(main, args);
  const job = jobQueue.submit(
    kind,
    args,
    async (job, signal) => {
      const page = await workerPage(project.url, { signal });
      let staged = false;
      try {
        signal.throwIfAborted();
        const result = await run(page, args, signal);
        signal.throwIfAborted();
        if (keep) {
          await keepStagedPage(page);
          staged = true;
        }
        return result;
      } finally {
        if (!staged) await page.close().catch(() => {});
      }
    },
    { dedupe: false },
  );
  return args.wait === false ? job : jobQueue.wait(job.id);
}
