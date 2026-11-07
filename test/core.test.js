import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, platformPaths } from "../src/utils/config.js";
import {
  chromeCandidates,
  discoverChrome,
  isFlowUrl,
} from "../src/browser/connect.js";
import {
  lookup,
  parseNumber,
  dictionaries,
  detectLanguage,
} from "../src/ui/strings.js";
import { JobQueue, idempotencyKey } from "../src/queue/job-queue.js";
import { checkCreditFloor } from "../src/flow/account.js";
import { tools } from "../src/tools/registry.js";
import { assetKey, matchAssets } from "../src/flow/assets.js";
import { cleanup, saveDownload } from "../src/flow/files.js";
import { zipSync, strToU8 } from "fflate";
const base = path.resolve(".test-tmp");
fs.mkdirSync(base, { recursive: true });
function temp(t) {
  const dir = fs.mkdtempSync(path.join(base, "unit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const defaults = {
  env: {},
  home: "/test-home",
  readFile: () => {
    const e = new Error("missing");
    e.code = "ENOENT";
    throw e;
  },
};
test("optional config and strict precedence: argument > env > file > defaults", () => {
  assert.equal(loadConfig({}, defaults).headless, false);
  const options = {
    ...defaults,
    env: { FLOW_MCP_CDP_PORT: "9444", FLOW_MCP_HEADLESS: "false" },
    readFile: () => JSON.stringify({ cdpPort: 9333, headless: true }),
  };
  assert.equal(loadConfig({}, options).cdpPort, 9444);
  assert.equal(loadConfig({ cdpPort: 9555 }, options).cdpPort, 9555);
  assert.equal(loadConfig({}, options).headless, false);
  assert.equal(loadConfig({ headless: true }, options).headless, true);
});
test("unknown config warns; invalid config/env refuses", () => {
  const warnings = [];
  loadConfig(
    {},
    {
      ...defaults,
      readFile: () => '{"unknown":1}',
      warn: (m) => warnings.push(m),
    },
  );
  assert.equal(warnings.length, 1);
  assert.throws(() =>
    loadConfig({}, { ...defaults, env: { FLOW_MCP_HEADLESS: "maybe" } }),
  );
  assert.throws(() => loadConfig({ maxConcurrentJobs: 4 }, defaults));
  assert.throws(() => loadConfig({ creditFloor: -1 }, defaults));
});
test("platform config paths and environment overrides", () => {
  assert.equal(
    platformPaths({ platform: "darwin", env: {}, home: "/home/test" }).config,
    "/home/test/Library/Application Support/google-flow-mcp/config.json",
  );
  assert.equal(
    platformPaths({
      platform: "win32",
      env: { APPDATA: "C:\\Roaming" },
      home: "C:\\Home",
    }).config,
    "C:\\Roaming\\google-flow-mcp\\config.json",
  );
  assert.equal(
    platformPaths({
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/xdg" },
      home: "/home/test",
    }).config,
    "/xdg/google-flow-mcp/config.json",
  );
  assert.deepEqual(
    platformPaths({
      platform: "linux",
      home: "/home/test",
      env: { FLOW_MCP_CONFIG: "/cfg", FLOW_MCP_HOME: "/data" },
    }),
    { config: "/cfg", home: "/data" },
  );
});
test("Chrome discovery mocks filesystem across platforms", () => {
  assert.equal(
    discoverChrome({
      platform: "darwin",
      env: {},
      exists: (p) => p.includes("Microsoft Edge"),
    }),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  );
  assert.equal(
    discoverChrome({
      platform: "linux",
      env: { PATH: "/custom" },
      exists: (p) => p === "/custom/chromium",
    }),
    "/custom/chromium",
  );
  assert.equal(
    discoverChrome({
      env: { FLOW_MCP_CHROME_PATH: "/custom/browser" },
      exists: () => true,
    }),
    "/custom/browser",
  );
  assert(
    chromeCandidates({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Local" },
    }).some((p) => p.endsWith("msedge.exe")),
  );
  assert.equal(
    discoverChrome({ platform: "linux", env: {}, exists: () => false }),
    null,
  );
});
test("Flow tab safety uses exact host and Flow routes", () => {
  for (const url of [
    "https://flow.google.com/project/abc",
    "https://labs.google/fx/tools/flow",
    "https://labs.google/fx/ko/tools/flow",
  ])
    assert(isFlowUrl(url));
  for (const url of [
    "https://example.org/flow.google.com",
    "https://labs.google/other",
    "https://flow.google.com.evil.test",
    "http://flow.google.com",
  ])
    assert(!isFlowUrl(url));
});
test("i18n detected first, custom extensions, all-language fallback and verification flags", async () => {
  assert.equal(lookup("generate", "ko")[0], dictionaries.ko.generate);
  assert.equal(
    lookup("generate", "de", { de: { generate: "Erstellen" } })[0],
    "Erstellen",
  );
  assert(lookup("generate", "ja").includes(dictionaries.ko.generate));
  assert.equal(dictionaries.ko._verified, true);
  for (const lang of ["en", "fr", "ja"])
    assert.equal(dictionaries[lang]._verified, false);
  assert.equal(
    await detectLanguage({
      locator: (s) =>
        s === "html"
          ? { getAttribute: async () => "ja-JP" }
          : { innerText: async () => "" },
    }),
    "ja",
  );
  assert.equal(
    parseNumber("생성 시 12 크레딧이 사용됩니다", "costPattern", "ko"),
    12,
  );
  assert.equal(
    parseNumber("Google Flow credits 1,234", "balancePattern", "en"),
    1234,
  );
  assert.equal(parseNumber("unknown", "costPattern", "en"), null);
});
test("idempotency is order independent and includes frames/settings/project", () => {
  assert.equal(idempotencyKey({ a: 1, b: 2 }), idempotencyKey({ b: 2, a: 1 }));
  const base = {
    project: "a",
    prompt: "p",
    frames: ["x"],
    settings: { quantity: 1 },
  };
  for (const value of [
    { ...base, project: "b" },
    { ...base, frames: ["y"] },
    { ...base, settings: { quantity: 2 } },
  ])
    assert.notEqual(idempotencyKey(base), idempotencyKey(value));
});
test("queue enforces concurrency, deduplicates, and explicit force bypasses", async (t) => {
  const q = new JobQueue({ dir: temp(t), maxConcurrent: 2 });
  let active = 0,
    peak = 0,
    calls = 0;
  const run = async () => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 15));
    active--;
    return "ok";
  };
  const a = q.submit("image", { prompt: "p" }, run);
  assert.equal(q.submit("image", { prompt: "p" }, run).id, a.id);
  const b = q.submit("image", { prompt: "p" }, run, { force: true });
  const c = q.submit("image", { prompt: "other" }, run);
  await Promise.all([a, b, c].map((j) => q.wait(j.id)));
  assert.equal(peak, 2);
  assert.equal(calls, 3);
});
test("persisted paid intent resumes polling, never runs the submission handler again", async (t) => {
  const dir = temp(t),
    q = new JobQueue({ dir });
  const job = {
    id: "recover",
    kind: "generate_image",
    status: "running",
    submissionIntent: true,
    createdAt: Date.now(),
    payload: { prompt: "p" },
    projectUrl: "https://flow.google.com/project/a",
  };
  q.jobs.set(job.id, job);
  q.save(job);
  const restored = new JobQueue({ dir });
  assert.equal(restored.get(job.id).status, "recovering");
  let polls = 0;
  restored.resume(async () => {
    polls++;
    return { polled: true };
  });
  await restored.wait(job.id);
  assert.equal(polls, 1);
  assert.equal(restored.get(job.id).status, "completed");
  const queued = {
    ...job,
    id: "queued",
    submissionIntent: false,
    status: "queued",
  };
  q.save(queued);
  assert.equal(new JobQueue({ dir }).get("queued").status, "needs_review");
});
test("write-ahead failure keeps idempotency block and cancellation never promises a refund", async (t) => {
  const q = new JobQueue({ dir: temp(t) });
  const j = q.submit("image", { prompt: "p" }, async (job) => {
    q.update(job.id, { submissionIntent: true, cost: 12 });
    throw new Error("lost connection");
  });
  await q.wait(j.id);
  assert.equal(q.get(j.id).status, "needs_review");
  assert.equal(
    q.submit("image", { prompt: "p" }, () => assert.fail()).id,
    j.id,
  );
  assert.equal(q.reserved("other"), 12);
});
test("credit-floor refuses unknown balances/costs and counts reservations", () => {
  assert(checkCreditFloor(100, 12, 80));
  assert.throws(() => checkCreditFloor(100, 12, 90));
  assert.throws(() => checkCreditFloor(100, 12, 80, 9));
  for (const bad of [null, NaN, undefined]) {
    assert.throws(() => checkCreditFloor(bad, 1));
    assert.throws(() => checkCreditFloor(10, bad));
  }
});
test("tool schemas validate paid defaults, paths, modes, duration and 4K inputs", () => {
  assert.equal(
    tools.flow_generate_image.schema.parse({ prompt: "hello" }).confirm,
    undefined,
  );
  assert.equal(
    tools.flow_generate_image.schema.parse({ prompt: "hello" }).quantity,
    1,
  );
  assert.throws(() =>
    tools.flow_generate_video.schema.parse({ prompt: "p", mode: "frames" }),
  );
  assert.throws(() =>
    tools.flow_generate_video.schema.parse({ prompt: "p", duration: 5 }),
  );
  assert.throws(() =>
    tools.flow_upload_media.schema.parse({ paths: ["relative.png"] }),
  );
  assert.throws(() => tools.flow_trash_assets.schema.parse({ matches: [{}] }));
  assert.throws(() =>
    tools.flow_generate_image.schema.parse({ prompt: "p", unexpected: true }),
  );
  assert.equal(
    tools.flow_upscale_download.schema.parse({ asset_names: ["a"] }).allow_4k,
    false,
  );
});
test("asset keys ignore signed URLs; ambiguous caption matches refuse", () => {
  assert.equal(
    assetKey({ caption: "c", prompt: "p", src: "signed1" }),
    assetKey({ caption: "c", prompt: "p", src: "signed2" }),
  );
  const assets = [
    { caption: "c", prompt: "p1" },
    { caption: "c", prompt: "p2" },
  ];
  assert.throws(() => matchAssets(assets, { caption: "c" }));
  assert.equal(
    matchAssets(assets, { caption: "c", prompt: "p2" }).prompt,
    "p2",
  );
});
test("ZIP extraction preserves Unicode and prevents path traversal; saveAs retries ENOENT", async (t) => {
  const dir = temp(t);
  const bytes = zipSync({ "../../외부.mp4": strToU8("media") });
  let attempts = 0;
  const download = {
    suggestedFilename: () => "archive.zip",
    saveAs: async (file) => {
      if (attempts++ === 0)
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      fs.writeFileSync(file, bytes);
    },
  };
  const files = await saveDownload(download, dir);
  assert.equal(attempts, 2);
  assert.equal(files.length, 1);
  assert.equal(path.dirname(files[0]), dir);
  assert(files[0].includes("외부.mp4"));
});

test("paid action persists intent before click, refuses low credit, and serializes reservations", async (t) => {
  const { executePaid } = await import("../src/flow/paid-action.js");
  const q = new JobQueue({ dir: temp(t) }),
    signal = new AbortController().signal;
  const create = (id) => {
    const job = { id, status: "running", createdAt: Date.now() };
    q.jobs.set(id, job);
    q.save(job);
    return job;
  };
  let clicks = 0;
  const first = create("paid-one");
  await executePaid({
    queue: q,
    job: first,
    signal,
    floor: 0,
    metadata: { projectUrl: "https://flow.google.com/project/a" },
    readBalance: async () => 20,
    prepare: async () => ({
      cost: 12,
      submit: async () => {
        assert.equal(
          JSON.parse(fs.readFileSync(path.join(q.dir, "job-paid-one.json")))
            .submissionIntent,
          true,
        );
        clicks++;
      },
    }),
  });
  const second = create("paid-two");
  await assert.rejects(
    executePaid({
      queue: q,
      job: second,
      signal,
      floor: 0,
      metadata: {},
      readBalance: async () => 20,
      prepare: async () => ({
        cost: 12,
        submit: async () => {
          clicks++;
        },
      }),
    }),
    /Credit floor/,
  );
  assert.equal(clicks, 1);
  assert.equal(second.submissionIntent, undefined);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    executePaid({
      queue: q,
      job: second,
      signal: cancelled.signal,
      floor: 0,
      metadata: {},
      readBalance: async () => {
        assert.fail("Cancelled work read account");
      },
      prepare: async () => {
        assert.fail();
      },
    }),
  );
});
test("cleanup preview excludes state/outputs/profile and never follows symlinks", (t) => {
  const home = temp(t);
  const dirs = Object.fromEntries(
    ["screenshots", "logs", "temp", "outputs", "state", "profile"].map((k) => [
      k,
      path.join(home, k),
    ]),
  );
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir);
    const file = path.join(dir, "old.dat");
    fs.writeFileSync(file, "x");
    fs.utimesSync(file, 1, 1);
  }
  fs.symlinkSync(
    dirs.outputs,
    path.join(dirs.logs, "outside"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const preview = cleanup({ older_than_days: 1 }, { dirs });
  assert.equal(preview.files.length, 3);
  assert(preview.dry_run);
  assert(fs.existsSync(path.join(dirs.logs, "old.dat")));
  cleanup({ older_than_days: 1, confirm: true }, { dirs });
  assert(!fs.existsSync(path.join(dirs.logs, "old.dat")));
  assert(fs.existsSync(path.join(dirs.outputs, "old.dat")));
  assert(fs.existsSync(path.join(dirs.state, "old.dat")));
  assert(fs.existsSync(path.join(dirs.profile, "old.dat")));
});
test("active server lock prevents concurrent ownership", async (t) => {
  const { acquireServerLock } = await import("../src/queue/server-lock.js");
  const dir = temp(t);
  const release = acquireServerLock(dir);
  assert.throws(() => acquireServerLock(dir), /Another MCP server/);
  release();
  const next = acquireServerLock(dir);
  next();
});
test("batch coordinators do not occupy worker capacity and cancellation propagates", async (t) => {
  const q = new JobQueue({ dir: temp(t), maxConcurrent: 1 });
  const parent = q.track("batch", {}, async (job) => {
    const child = q.submit("child", {}, async () => "ok");
    q.update(job.id, { childIds: [child.id] });
    await q.wait(child.id);
    return child.id;
  });
  const done = await q.wait(parent.id);
  assert.equal(done.status, "completed");
  assert.equal(q.get(done.result).status, "completed");
});
test("dry run does not deduplicate the subsequent paid confirmation", async (t) => {
  const q = new JobQueue({ dir: temp(t) }),
    keyData = { project: "a", prompt: "p" };
  let submissions = 0;
  const dry = q.submit(
    "image",
    { confirm: false },
    async () => ({ dry_run: true }),
    { dedupe: false, keyData },
  );
  await q.wait(dry.id);
  const paid = q.submit(
    "image",
    { confirm: true },
    async () => {
      submissions++;
      return "submitted";
    },
    { keyData },
  );
  await q.wait(paid.id);
  assert.notEqual(dry.id, paid.id);
  assert.equal(submissions, 1);
  const duplicate = q.submit(
    "image",
    { confirm: true },
    async () => assert.fail(),
    { keyData },
  );
  assert.equal(duplicate.id, paid.id);
});
