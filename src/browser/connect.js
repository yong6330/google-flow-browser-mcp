import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { loadConfig, dataPaths, ensureData } from "../utils/config.js";

export function chromeCandidates({
  platform = process.platform,
  env = process.env,
} = {}) {
  if (env.FLOW_MCP_CHROME_PATH) return [env.FLOW_MCP_CHROME_PATH];
  if (platform === "darwin")
    return ["Google Chrome", "Chromium", "Microsoft Edge"].map(
      (n) => `/Applications/${n}.app/Contents/MacOS/${n}`,
    );
  if (platform === "win32")
    return [
      env.PROGRAMFILES || env.ProgramFiles,
      env["PROGRAMFILES(X86)"] || env["ProgramFiles(x86)"],
      env.LOCALAPPDATA || env.LocalAppData,
    ]
      .filter(Boolean)
      .flatMap((base) =>
        [
          "Google/Chrome/Application/chrome.exe",
          "Chromium/Application/chrome.exe",
          "Microsoft/Edge/Application/msedge.exe",
        ].map((p) => path.win32.join(base, p)),
      );
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  return (env.PATH || "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean)
    .flatMap((p) =>
      [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
      ].map((n) => platformPath.join(p, n)),
    )
    .concat([
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    ]);
}
export function discoverChrome(options = {}) {
  return (
    chromeCandidates(options).find(options.exists || fs.existsSync) || null
  );
}
export const isFlowUrl = (value) => {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      (u.hostname === "flow.google.com" ||
        (u.hostname === "labs.google" &&
          /^\/fx\/(?:[a-z-]+\/)?tools\/flow(?:\/|$)/.test(u.pathname)))
    );
  } catch {
    return false;
  }
};
export async function cdpInfo(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
async function freePort(port) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", (e) =>
      e.code === "EADDRINUSE" ? freePort(0).then(resolve, reject) : reject(e),
    );
    s.listen(port, "127.0.0.1", () => {
      const n = s.address().port;
      s.close(() => resolve(n));
    });
  });
}
let connection;
let pendingConnection;
let chromiumLoader;
async function loadChromium(c) {
  if (!chromiumLoader)
    chromiumLoader = (async () => {
      // Playwright allocates CDP artifacts at module load; confine them to the data temp directory.
      const key = process.platform === "win32" ? "TEMP" : "TMPDIR";
      const previous = process.env[key];
      process.env[key] = dataPaths(c).temp;
      try {
        return (await import("playwright-core")).chromium;
      } finally {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
    })();
  return chromiumLoader;
}
export async function launchBrowser(options = {}) {
  const c = loadConfig(options),
    dirs = ensureData(c);
  // DevToolsActivePort identifies the dedicated profile; never attach to an arbitrary CDP server.
  const active = path.join(dirs.profile, "DevToolsActivePort");
  try {
    const [port, endpoint] = fs.readFileSync(active, "utf8").trim().split("\n");
    const info = await cdpInfo(Number(port));
    if (info?.webSocketDebuggerUrl?.endsWith(endpoint))
      return { port: Number(port), config: c, attached: true };
  } catch {
    /* first launch or stale marker */
  }
  const chrome = c.chromePath || discoverChrome();
  if (!chrome || !fs.existsSync(chrome))
    throw new Error(
      "Chrome/Chromium/Edge not found. Install it or set FLOW_MCP_CHROME_PATH.",
    );
  const port = await freePort(c.cdpPort);
  const logFile = path.join(dirs.logs, `chrome-${Date.now()}.log`);
  const fd = fs.openSync(logFile, "a", 0o600);
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${dirs.profile}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (c.headless) args.push("--headless=new");
  args.push(c.flowUrl);
  // UNVERIFIED-LIVE: cross-platform detached launch and sandbox error diagnosis require a normal desktop environment.
  const child = spawn(chrome, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: false,
  });
  fs.closeSync(fd);
  let spawnError;
  child.on("error", (e) => {
    spawnError = e;
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    if (spawnError) throw spawnError;
    const info = await cdpInfo(port);
    if (info) {
      const endpoint = new URL(info.webSocketDebuggerUrl).pathname;
      fs.writeFileSync(active, `${port}\n${endpoint}\n`, { mode: 0o600 });
      return { port, config: c, attached: false };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const log = fs.readFileSync(logFile, "utf8");
  if (/crashpad|bootstrap_check_in|permission denied/i.test(log))
    throw new Error(
      "Chrome crashed inside a sandbox (Crashpad permission error). Run node scripts/start-browser.mjs from a normal terminal, then retry flow_connect to attach.",
    );
  throw new Error(
    `Chrome CDP did not start. Check ${logFile}. If this dedicated profile is already open without CDP, close that window and retry.`,
  );
}
export async function connectToBrowser(options = {}) {
  if (connection?.browser.isConnected()) return connection;
  if (pendingConnection) return pendingConnection;
  pendingConnection = attach(options);
  try {
    return await pendingConnection;
  } finally {
    pendingConnection = null;
  }
}
async function attach(options) {
  const launched = await launchBrowser(options);
  const chromium = await loadChromium(launched.config);
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${launched.port}`,
  );
  const context = browser.contexts()[0];
  connection = { ...launched, browser, context };
  // Work in our own background tab so the user's tabs, focus and scroll stay untouched.
  const current = context.pages().find((p) => isFlowUrl(p.url()));
  const page = await backgroundPage(
    current ? current.url() : launched.config.flowUrl,
  );
  connection.page = page;
  return connection;
}
// Target.createTarget with background:true opens a tab without activating it,
// unlike context.newPage(), which brings the tab to the front.
async function backgroundPage(url) {
  const { browser, context } = connection;
  const cdp = await browser.newBrowserCDPSession();
  try {
    const [page] = await Promise.all([
      context.waitForEvent("page"),
      cdp.send("Target.createTarget", { url: "about:blank", background: true }),
    ]);
    page.setDefaultTimeout(8000);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return page;
  } finally {
    await cdp.detach().catch(() => {});
  }
}
export function getPage() {
  if (!connection) throw new Error("Call flow_connect first.");
  if (!isFlowUrl(connection.page.url()))
    throw new Error(
      "Sign in manually in the dedicated Chrome window, then retry.",
    );
  return connection.page;
}
export const getContext = () => connection?.context;
export const connectionConfig = () => connection?.config;
let stagedPages = [];
export async function keepStagedPage(page) {
  stagedPages = stagedPages.filter((p) => !p.isClosed());
  stagedPages.push(page);
  while (stagedPages.length > 3)
    await stagedPages
      .shift()
      .close()
      .catch(() => {});
}
export const getBrowser = () => connection?.browser;
export const isBrowserConnected = () => !!connection?.browser.isConnected();
export async function workerPage(url, { signal } = {}) {
  if (!isFlowUrl(url)) throw new Error("Refusing non-Flow URL");
  const p = await backgroundPage("about:blank");
  if (signal) {
    const close = () => void p.close().catch(() => {});
    signal.addEventListener("abort", close, { once: true });
    p.once("close", () => signal.removeEventListener("abort", close));
    if (signal.aborted) {
      await p.close();
      signal.throwIfAborted();
    }
  }
  p.setDefaultTimeout(8000);
  await p.goto(url, { waitUntil: "domcontentloaded" });
  return p;
}
export async function closeBrowser() {
  // Close only the tab this server opened; the user's tabs stay as they were.
  if (connection) {
    await connection.page?.close().catch(() => {});
    await connection.browser.close();
  }
  connection = null;
}
export const browserStatus = () =>
  connection
    ? {
        connected: isBrowserConnected(),
        port: connection.port,
        url: connection.page.url(),
        profile: dataPaths(connection.config).profile,
      }
    : { connected: false };
