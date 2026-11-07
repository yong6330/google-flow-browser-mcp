import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { config, dataPaths } from "../utils/config.js";
const terminal = new Set(["completed", "failed", "cancelled", "needs_review"]);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export function idempotencyKey(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export class JobQueue {
  constructor({
    dir = dataPaths().state,
    maxConcurrent = config.maxConcurrentJobs,
    windowMs = config.idempotencyWindowMs,
  } = {}) {
    this.dir = dir;
    this.maxConcurrent = maxConcurrent;
    this.windowMs = windowMs;
    this.jobs = new Map();
    this.tasks = new Map();
    this.active = 0;
    this.controllers = new Map();
    this.promises = new Map();
    this.creditTail = Promise.resolve();
    if (fs.existsSync(dir))
      for (const name of fs
        .readdirSync(dir)
        .filter((n) => /^job-.*\.json$/.test(n))) {
        const job = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        // Queued requests must not be replayed into a paid click after restart.
        if (
          job.submissionIntent &&
          job.status !== "completed" &&
          !job.cancelRequested
        )
          job.status = "recovering";
        else if (!terminal.has(job.status)) job.status = "needs_review";
        this.jobs.set(job.id, job);
      }
  }
  save(job) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const dest = path.join(this.dir, `job-${job.id}.json`),
      temp = `${dest}.tmp`;
    const fd = fs.openSync(temp, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(job, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, dest);
  }
  update(id, patch) {
    const job = this.get(id);
    Object.assign(job, patch, { updatedAt: Date.now() });
    this.save(job);
    return job;
  }
  get(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Unknown job id");
    return job;
  }
  list() {
    return [...this.jobs.values()];
  }
  submit(
    kind,
    payload,
    run,
    { force = false, dedupe = true, keyData = payload } = {},
  ) {
    const key = idempotencyKey({ kind, ...keyData });
    if (dedupe && !force) {
      const old = this.list().find(
        (j) =>
          j.key === key &&
          j.dedupeEligible !== false &&
          Date.now() - j.createdAt < this.windowMs &&
          j.status !== "cancelled",
      );
      if (old) return { ...old, deduplicated: true };
    }
    const job = {
      id: randomUUID(),
      key,
      dedupeEligible: dedupe,
      kind,
      payload,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.save(job);
    this.tasks.set(job.id, run);
    this.pump();
    return job;
  }
  track(kind, payload, run) {
    const job = {
      id: randomUUID(),
      kind,
      payload,
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      childIds: [],
    };
    this.jobs.set(job.id, job);
    this.save(job);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const promise = Promise.resolve()
      .then(() => run(job, controller.signal))
      .then((result) =>
        this.update(job.id, {
          status: controller.signal.aborted ? "cancelled" : "completed",
          result,
        }),
      )
      .catch((e) =>
        this.update(job.id, {
          status: controller.signal.aborted ? "cancelled" : "failed",
          error: e.message,
        }),
      )
      .finally(() => this.controllers.delete(job.id));
    this.promises.set(job.id, promise);
    return job;
  }
  pump() {
    for (const [id, run] of this.tasks) {
      if (this.active >= this.maxConcurrent) break;
      this.tasks.delete(id);
      const job = this.get(id);
      if (job.status === "cancelled") continue;
      this.active++;
      const controller = new AbortController();
      this.controllers.set(id, controller);
      this.update(id, { status: "running" });
      const promise = Promise.resolve()
        .then(() => run(job, controller.signal))
        .then((result) => {
          if (controller.signal.aborted)
            return this.update(id, {
              status: job.submissionIntent ? "needs_review" : "cancelled",
              note: "Cancellation stops local work only; server-side paid work may continue.",
            });
          return this.update(id, { status: "completed", result });
        })
        .catch((e) =>
          this.update(id, {
            status: job.submissionIntent
              ? "needs_review"
              : controller.signal.aborted
                ? "cancelled"
                : "failed",
            error: e.message,
          }),
        )
        .finally(() => {
          this.active--;
          this.controllers.delete(id);
          this.pump();
        });
      this.promises.set(id, promise);
    }
  }
  async wait(id) {
    while (["queued", "running"].includes(this.get(id).status)) {
      const promise = this.promises.get(id);
      if (promise) await promise;
      else await new Promise((r) => setTimeout(r, 20));
    }
    return this.get(id);
  }
  cancel(id) {
    const j = this.get(id);
    if (terminal.has(j.status))
      return j.status === "needs_review" && j.submissionIntent
        ? this.update(id, { cancelRequested: true })
        : j;
    this.controllers.get(id)?.abort();
    for (const child of j.childIds || []) this.cancel(child);
    this.tasks.delete(id);
    return this.update(id, {
      status: j.submissionIntent ? "needs_review" : "cancelled",
      cancelRequested: true,
      note: "Local cancellation only; never cancels a generation already submitted to Flow.",
    });
  }
  async withCredits(fn) {
    const previous = this.creditTail;
    let release;
    this.creditTail = new Promise((r) => {
      release = r;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
  reserved(except) {
    return this.list()
      .filter(
        (j) =>
          j.id !== except &&
          j.submissionIntent &&
          !["completed", "cancelled"].includes(j.status),
      )
      .reduce((sum, j) => sum + (j.cost || 0), 0);
  }
  resume(run) {
    for (const job of this.list().filter(
      (j) =>
        j.status === "recovering" ||
        (j.status === "needs_review" &&
          j.submissionIntent &&
          !j.cancelRequested),
    )) {
      this.update(job.id, { status: "queued" });
      this.tasks.set(job.id, (j, s) => run(j, s));
    }
    this.pump();
  }
}
export const jobQueue = new JobQueue();
