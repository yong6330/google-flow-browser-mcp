import { z } from "zod/v3";
import path from "node:path";
import fs from "node:fs";
import { config, dataPaths } from "../utils/config.js";
import {
  connectToBrowser,
  closeBrowser,
  getPage,
  browserStatus,
  discoverChrome,
  cdpInfo,
} from "../browser/connect.js";
import { detectLanguage } from "../ui/strings.js";
import { guard } from "../ui/actions.js";
import { projects } from "../flow/projects.js";
import {
  scanAssets,
  renameAsset,
  changeTrash,
  uploadMedia,
} from "../flow/assets.js";
import { downloadAsset } from "../flow/download.js";
import { upscale } from "../flow/upscale.js";
import { generate, resumeJob } from "../flow/generation.js";
import { accountInfo } from "../flow/account.js";
import { cleanup, screenshot } from "../flow/files.js";
import { workerJob } from "../flow/worker-job.js";
import { legacy } from "../flow/legacy.js";
import { jobQueue } from "../queue/job-queue.js";
const absolute = z
  .string()
  .refine((v) => path.isAbsolute(v), "Must be an absolute path");
const strings = z.array(z.string().min(1)).max(100);
const context = {
  project_id: z.string().min(1).optional(),
  project_name: z.string().min(1).optional(),
  campaign: z.string().optional(),
};
const paid = {
  confirm: z.boolean().optional(),
  auto_confirm: z.boolean().optional().describe("Deprecated alias for confirm"),
  force: z.boolean().default(false),
  wait: z.boolean().default(true),
  creditFloor: z.number().nonnegative().optional(),
};
const output = { output_folder: absolute.optional() };
const match = z
  .object({
    key: z.string().optional(),
    caption: z.string().optional(),
    prompt: z.string().optional(),
    index: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (m) =>
      m.key !== undefined || m.caption !== undefined || m.index !== undefined,
    "Supply key, caption or index",
  );
const ratio = z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]);
const generation = {
  ...context,
  ...paid,
  ...output,
  prompt: z.string().min(1),
  model: z.string().min(1),
  ratio: ratio.default("16:9"),
  quantity: z.number().int().min(1).max(4).default(1),
  reference_images: strings.default([]),
  download: z.boolean().default(false),
  name: z.string().optional(),
  autoCaption: z.string().optional(),
  brand: z.string().optional(),
};
const definitions = {};
function tool(name, description, shape, run) {
  definitions[name] = {
    description,
    schema: shape instanceof z.ZodType ? shape : z.object(shape).strict(),
    run,
  };
}
export async function doctor() {
  const status = browserStatus(),
    chrome = config.chromePath || discoverChrome();
  let profileWritable = false;
  const profile = dataPaths().profile;
  try {
    let p = profile;
    while (!fs.existsSync(p)) {
      const parent = path.dirname(p);
      if (parent === p) break;
      p = parent;
    }
    fs.accessSync(p, fs.constants.W_OK);
    profileWritable = true;
  } catch {
    /* diagnostics only */
  }
  const result = {
    node: process.version,
    nodeSupported: Number(process.versions.node.split(".")[0]) >= 18,
    chromePath: chrome,
    chromeFound: !!chrome && fs.existsSync(chrome),
    profile,
    profileWritable,
    cdp: await cdpInfo(status.port || config.cdpPort),
    browser: status,
    login: "not checked (connect first)",
    language: null,
    credits: null,
  };
  if (status.connected) {
    try {
      result.language = await detectLanguage(getPage());
    } catch {
      /* login redirects may prevent inspection */
    }
    try {
      Object.assign(result, await accountInfo(getPage()), {
        login: "signed-in account inspected",
      });
    } catch (e) {
      result.login = e.message;
    }
  }
  return result;
}
tool(
  "flow_connect",
  "Launch/attach dedicated Chrome. Sign in manually once in the visible window.",
  {
    headless: z.boolean().optional(),
    open_flow: z.boolean().default(true),
    chromePath: absolute.optional(),
    cdpPort: z.number().int().min(1024).max(65535).optional(),
    expectedAccount: z.string().email().optional(),
  },
  async (args) => {
    const c = await connectToBrowser(args);
    let account;
    try {
      await guard(c.page);
      account = await accountInfo(
        c.page,
        args.expectedAccount ?? config.expectedAccount,
      );
    } catch (e) {
      if (args.expectedAccount || config.expectedAccount) throw e;
      return {
        ...browserStatus(),
        status: "needs_login_or_verification",
        message: e.message,
        instructions:
          "Sign in once manually in this dedicated Chrome window; never share the profile directory.",
      };
    }
    jobQueue.resume(resumeJob);
    return { ...browserStatus(), status: "connected", ...account };
  },
);
tool(
  "flow_disconnect",
  "Detach MCP; keep dedicated Chrome and its persistent profile.",
  {},
  async () => {
    await closeBrowser();
    return { status: "disconnected" };
  },
);
tool(
  "flow_status",
  "Connection and persisted job state. No browser launch.",
  { full: z.boolean().default(false) },
  async () => ({ ...browserStatus(), jobs: jobQueue.list() }),
);
tool(
  "flow_doctor",
  "Check runtime, Chrome, profile, CDP; inspect login/language/credits when connected.",
  {},
  doctor,
);
tool(
  "flow_account_check",
  "Report signed-in email; enforce expectedAccount only when configured.",
  {},
  () => accountInfo(getPage()),
);
tool(
  "flow_credits",
  "Read the credit balance from the account popover.",
  {},
  () => accountInfo(getPage()),
);
tool(
  "flow_projects",
  "List, open by name/id, or create a named Flow project.",
  z
    .object({
      action: z.enum(["list", "open", "create"]).default("list"),
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
    })
    .strict()
    .refine(
      (a) =>
        a.action === "list" ||
        (a.action === "create" ? !!a.name : !!(a.name || a.id)),
      "Name/id required",
    ),
  (a) => projects(getPage(), a),
);
tool(
  "flow_list_assets",
  "Scan virtual media grid; stable caption/prompt keys, no signed URL IDs.",
  {
    ...context,
    type: z.enum(["image", "video", "all"]).default("all"),
    include_trashed: z.boolean().default(false),
  },
  async (a) => {
    await import("../flow/projects.js").then((m) =>
      m.ensureProject(getPage(), a),
    );
    return scanAssets(getPage(), a);
  },
);
tool(
  "flow_upload_media",
  "Upload absolute local paths, deduplicated by file name.",
  {
    ...context,
    paths: z.array(absolute).min(1).max(100),
    wait: z.boolean().default(true),
  },
  (a) => workerJob(getPage(), "upload", a, uploadMedia),
);
tool(
  "flow_generate_image",
  "Stage image settings and report cost. Only confirm:true spends credits; returns job id.",
  z
    .object({
      ...generation,
      model: z
        .string()
        .optional()
        .describe(
          'Model name exactly as Flow shows it, for example "Omni 1.2 Flash". Omit to keep the current selection.',
        ),
    })
    .strict()
    .refine((a) => !a.name || a.quantity === 1, "name requires quantity:1"),
  (a) => generate(getPage(), "image", a),
);
tool(
  "flow_generate_video",
  "Stage text, frames or ingredients video. Only confirm:true spends credits; returns job id.",
  z
    .object({
      ...generation,
      model: z
        .string()
        .optional()
        .describe(
          'Model name exactly as Flow shows it, for example "Omni 1.2 Flash". Omit to keep the current selection.',
        ),
      mode: z.enum(["text", "frames", "ingredients"]).default("text"),
      duration: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe(
          "Seconds. Omit to keep Flow's current length. Some models (Veo 3.1) have no length control.",
        ),
      resolution: z
        .enum(["360p", "720p"])
        .optional()
        .describe(
          "Omit to keep Flow's current resolution. Some models (Veo 3.1) have no resolution control.",
        ),
      start_image: z.string().min(1).optional(),
      end_image: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((a, ctx) => {
      if (a.name && a.quantity !== 1)
        ctx.addIssue({ code: "custom", message: "name requires quantity:1" });
      if (a.mode === "frames" && a.reference_images.length)
        ctx.addIssue({
          code: "custom",
          message: "Use frame slots instead of reference_images in frames mode",
        });
      if (a.mode === "frames" && !a.start_image)
        ctx.addIssue({
          code: "custom",
          message: "Frames mode requires start_image",
        });
      if (a.mode !== "frames" && (a.start_image || a.end_image))
        ctx.addIssue({
          code: "custom",
          message: "Frame slots require frames mode",
        });
      if (a.mode === "text" && a.reference_images.length)
        ctx.addIssue({
          code: "custom",
          message: "References require ingredients mode",
        });
      if (a.mode === "ingredients" && !a.reference_images.length)
        ctx.addIssue({
          code: "custom",
          message: "Ingredients mode requires reference_images",
        });
    }),
  (a) => generate(getPage(), "video", a),
);
tool(
  "flow_rename_asset",
  "Rename exact matched caption; refuses to type in a mismatched title field.",
  { match, name: z.string().min(1).max(250) },
  (a) => renameAsset(getPage(), a),
);
for (const restore of [false, true])
  tool(
    restore ? "flow_restore_assets" : "flow_trash_assets",
    restore
      ? "Restore matched trash tiles; dry run unless confirm:true."
      : "Move matched assets to trash; dry run unless confirm:true. Never permanently delete.",
    {
      matches: z.array(match).min(1).max(100),
      wait: z.boolean().default(true),
      confirm: z.boolean().default(false),
    },
    (a) =>
      workerJob(
        getPage(),
        restore ? "restore" : "trash",
        a,
        (page, args, signal) => changeTrash(page, args, restore, signal),
      ),
  );
tool(
  "flow_download_asset",
  "Save 270p GIF/720p; 1080p routes through paid upscale safeguards.",
  {
    match,
    quality: z.enum(["270p-gif", "720p", "1080p"]).default("720p"),
    ...paid,
    ...output,
  },
  async (a) => {
    if (a.quality === "1080p") {
      const { matchAssets } = await import("../flow/assets.js");
      const asset = matchAssets(await scanAssets(getPage()), a.match);
      return runUpscale({
        ...a,
        match: {
          caption: asset.caption,
          prompt: asset.prompt ?? undefined,
          key: asset.key,
        },
        asset_names: [asset.caption],
        resolution: "1080p",
        confirm: a.confirm ?? a.auto_confirm ?? false,
      });
    }
    return workerJob(getPage(), "download", a, downloadAsset);
  },
);
async function runUpscale(a) {
  const page = getPage();
  const parent = jobQueue.track("upscale_batch", a, (job, signal) =>
    upscale(page, a, { job, signal }),
  );
  return a.wait === false
    ? { job_id: parent.id, status: parent.status }
    : jobQueue.wait(parent.id);
}

tool(
  "flow_upscale_download",
  "Paid upscale/download. Verify the 1080p result and get the user's OK before 4K; never chain 1080p and 4K. Requires confirm:true and allow_4k:true for 4K.",
  {
    ...context,
    ...output,
    ...paid,
    asset_names: strings.min(1),
    resolution: z.enum(["1080p", "4k"]).default("1080p"),
    allow_4k: z.boolean().default(false),
    accept_unknown_cost: z
      .boolean()
      .default(false)
      .describe(
        "Proceed when Flow shows no credit cost in the download menu (field-tested: a 4 s 1080p upscale showed no cost and left the balance unchanged). The balance must still be readable and above creditFloor.",
      ),
    compare_with: absolute.optional(),
  },
  (a) => runUpscale({ ...a, confirm: a.confirm ?? a.auto_confirm ?? false }),
);
tool(
  "flow_screenshot",
  "On-demand screenshot with short timeout and CDP fallback.",
  { name: z.string().default("manual") },
  (a) => screenshot(getPage(), a.name),
);
tool(
  "flow_cleanup",
  "List logs/screenshots/temp older than N days; confirm:true removes only these files.",
  {
    older_than_days: z.number().int().min(1).default(7),
    confirm: z.boolean().default(false),
  },
  cleanup,
);
tool(
  "flow_job_status",
  "Read persisted job state; wait:true waits for an active job.",
  { job_id: z.string(), wait: z.boolean().default(false) },
  (a) => (a.wait ? jobQueue.wait(a.job_id) : jobQueue.get(a.job_id)),
);
tool(
  "flow_job_cancel",
  "Cancel queued/local work; paid server work may continue. Never resubmit.",
  { job_id: z.string() },
  (a) => jobQueue.cancel(a.job_id),
);
tool(
  "flow_queue_status",
  "List active, queued and historical jobs.",
  { history_limit: z.number().int().min(1).default(20) },
  (a) => jobQueue.list().slice(-a.history_limit),
);
tool(
  "flow_download_latest",
  "Compatibility alias: safely download the newest inventoried asset.",
  {
    ...output,
    wait: z.boolean().default(true),
    quality: z.enum(["270p-gif", "720p"]).default("720p"),
  },
  async (a) => {
    const list = await scanAssets(getPage());
    if (!list.length) throw new Error("No assets");
    return workerJob(
      getPage(),
      "download",
      { ...a, match: { key: list[0].key } },
      downloadAsset,
    );
  },
);
tool(
  "flow_discover_ui",
  "Inspect current Flow controls without guessing selectors or writing repo files.",
  { page: z.string().default("main") },
  (a) => legacy(getPage(), "discover", a),
);
tool(
  "flow_open_characters",
  "Open character section and inspect available controls.",
  {},
  (a) => legacy(getPage(), "characters", a),
);
tool(
  "flow_open_tools_gallery",
  "Open tools gallery and inspect available controls.",
  {},
  (a) => legacy(getPage(), "gallery", a),
);
tool(
  "flow_create_character",
  "Stage a named character description; no paid submit.",
  {
    ...context,
    wait: z.boolean().default(true),
    name: z.string().min(1),
    description: z.string().min(1),
    reference_images: z.array(absolute).optional(),
  },
  (a) =>
    workerJob(getPage(), "character", a, (p, a) => legacy(p, "character", a), {
      keep: true,
    }),
);
tool(
  "flow_import_character",
  "Stage character from a local JSON file; no paid submit.",
  { ...context, wait: z.boolean().default(true), file_path: absolute },
  (a) =>
    workerJob(getPage(), "import", a, (p, a) => legacy(p, "import", a), {
      keep: true,
    }),
);
tool(
  "flow_create_scene",
  "Stage scene prompt and characters; no paid submit.",
  {
    ...context,
    wait: z.boolean().default(true),
    prompt: z.string().min(1),
    characters: strings.optional(),
  },
  (a) =>
    workerJob(getPage(), "scene", a, (p, a) => legacy(p, "scene", a), {
      keep: true,
    }),
);
tool(
  "flow_use_grid_architect",
  "Stage grid theme, shots, engine and ratio; no paid submit.",
  {
    ...context,
    wait: z.boolean().default(true),
    theme_prompt: z.string().min(1),
    shot_prompts: strings.optional(),
    engine: z.string().optional(),
    ratio: ratio.optional(),
    visual_logic: z.string().optional(),
    references: z.array(absolute).optional(),
  },
  (a) =>
    workerJob(getPage(), "grid", a, (p, a) => legacy(p, "grid", a), {
      keep: true,
    }),
);
tool(
  "flow_use_tool",
  "Open an exact named Flow tool and stage named text fields.",
  {
    ...context,
    tool_name: z.string().min(1),
    params: z.record(z.string()).optional(),
  },
  (a) => legacy(getPage(), "tool", a),
);
export const tools = definitions;
export async function callTool(name, args = {}) {
  const tool = definitions[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.run(tool.schema.parse(args));
}
