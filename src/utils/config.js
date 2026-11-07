import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod/v3";

const absolute = z
  .string()
  .refine((v) => path.isAbsolute(v), "Must be an absolute path");
export const configSchema = z.object({
  home: absolute,
  chromePath: absolute.optional(),
  flowUrl: z
    .string()
    .url()
    .refine((v) => {
      const u = new URL(v);
      return (
        u.protocol === "https:" &&
        ((u.hostname === "labs.google" &&
          /^\/fx\/(?:[a-z-]+\/)?tools\/flow(?:\/|$)/.test(u.pathname)) ||
          u.hostname === "flow.google.com")
      );
    }, "Must be a Flow URL"),
  expectedAccount: z.string().email().optional(),
  cdpPort: z.number().int().min(1024).max(65535),
  headless: z.boolean(),
  maxConcurrentJobs: z.number().int().min(1).max(3),
  creditFloor: z.number().nonnegative(),
  jobTimeoutMs: z.number().int().positive(),
  pollIntervalMs: z.number().int().positive(),
  idempotencyWindowMs: z.number().int().positive(),
  downloadWaitMs: z.number().int().positive(),
  uiStrings: z.record(
    z
      .record(z.union([z.string(), z.array(z.string()), z.boolean()]))
      .refine(
        (values) =>
          Object.entries(values).every(
            ([key, value]) => key === "_verified" || typeof value !== "boolean",
          ),
        "Only _verified may be boolean",
      ),
  ),
});
export const envKeys = {
  home: "HOME",
  chromePath: "CHROME_PATH",
  flowUrl: "FLOW_URL",
  expectedAccount: "EXPECTED_ACCOUNT",
  cdpPort: "CDP_PORT",
  headless: "HEADLESS",
  maxConcurrentJobs: "MAX_CONCURRENT_JOBS",
  creditFloor: "CREDIT_FLOOR",
  jobTimeoutMs: "JOB_TIMEOUT_MS",
  pollIntervalMs: "POLL_INTERVAL_MS",
  idempotencyWindowMs: "IDEMPOTENCY_WINDOW_MS",
  downloadWaitMs: "DOWNLOAD_WAIT_MS",
  uiStrings: "UI_STRINGS",
};
export function platformPaths({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const base =
    platform === "darwin"
      ? p.join(home, "Library", "Application Support")
      : platform === "win32"
        ? env.APPDATA || p.join(home, "AppData", "Roaming")
        : env.XDG_CONFIG_HOME || p.join(home, ".config");
  return {
    config:
      env.FLOW_MCP_CONFIG || p.join(base, "google-flow-mcp", "config.json"),
    home: env.FLOW_MCP_HOME || p.join(home, ".google-flow-mcp"),
  };
}
export function loadConfig(
  args = {},
  {
    env = process.env,
    platform = process.platform,
    home = os.homedir(),
    readFile = (f) => fs.readFileSync(f, "utf8"),
    warn = (m) => console.error(m),
  } = {},
) {
  const locations = platformPaths({ platform, env, home });
  let file = {};
  try {
    file = JSON.parse(readFile(locations.config));
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error(`Invalid config: ${e.message}`);
  }
  if (!file || Array.isArray(file) || typeof file !== "object")
    throw new Error("Config must be an object");
  for (const key of Object.keys(file))
    if (!(key in configSchema.shape)) warn(`Unknown config key: ${key}`);
  const defaults = {
    home: locations.home,
    flowUrl: "https://labs.google/fx/tools/flow",
    cdpPort: 9222,
    headless: false,
    maxConcurrentJobs: 1,
    creditFloor: 0,
    jobTimeoutMs: 600000,
    pollIntervalMs: 5000,
    idempotencyWindowMs: 86400000,
    downloadWaitMs: 300000,
    uiStrings: {},
  };
  const environment = {};
  for (const [key, suffix] of Object.entries(envKeys)) {
    const value = env[`FLOW_MCP_${suffix}`];
    if (value === undefined) continue;
    environment[key] = [
      "cdpPort",
      "maxConcurrentJobs",
      "creditFloor",
      "jobTimeoutMs",
      "pollIntervalMs",
      "idempotencyWindowMs",
      "downloadWaitMs",
    ].includes(key)
      ? Number(value)
      : key === "headless"
        ? value === "true"
          ? true
          : value === "false"
            ? false
            : value
        : key === "uiStrings"
          ? JSON.parse(value)
          : value;
  }
  return configSchema.parse({
    ...defaults,
    ...file,
    ...environment,
    ...Object.fromEntries(
      Object.entries(args).filter(
        ([k, v]) => k in configSchema.shape && v !== undefined,
      ),
    ),
  });
}
export const config = loadConfig();
export default config;
export const get = (key, fallback) => config[key] ?? fallback;
export const getFlowHome = () => config.home;
export function dataPaths(c = config) {
  return Object.fromEntries(
    ["profile", "outputs", "logs", "state", "screenshots", "temp"].map((k) => [
      k,
      path.join(c.home, k),
    ]),
  );
}
export function ensureData(c = config) {
  for (const dir of Object.values(dataPaths(c)))
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dataPaths(c);
}
