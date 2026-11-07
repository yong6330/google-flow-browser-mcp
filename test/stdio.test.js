import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
test("MCP stdio initialize and tools/list: stdout contains only JSON-RPC", async (t) => {
  const root = path.resolve(".test-tmp");
  fs.mkdirSync(root, { recursive: true });
  const home = fs.mkdtempSync(path.join(root, "stdio-"));
  const child = spawn(process.execPath, ["src/index.js"], {
    env: {
      ...process.env,
      FLOW_MCP_HOME: home,
      FLOW_MCP_CONFIG: path.join(home, "missing.json"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill();
    fs.rmSync(home, { recursive: true, force: true });
  });
  let errors = "";
  child.stderr.on("data", (d) => (errors += d));
  const pending = new Map(),
    lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (e) {
      assert.fail(`Non-JSON stdout: ${line}`);
    }
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  const rpc = (id, method, params) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`RPC timeout: ${errors}`)),
        10000,
      );
      pending.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  const initialized = await rpc(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "offline-test", version: "1" },
  });
  assert.equal(initialized.result.serverInfo.version, "2.0.0");
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );
  const listed = await rpc(2, "tools/list", {});
  const names = listed.result.tools.map((t) => t.name);
  for (const name of [
    "flow_connect",
    "flow_disconnect",
    "flow_status",
    "flow_doctor",
    "flow_projects",
    "flow_list_assets",
    "flow_upload_media",
    "flow_generate_image",
    "flow_generate_video",
    "flow_rename_asset",
    "flow_trash_assets",
    "flow_restore_assets",
    "flow_download_asset",
    "flow_upscale_download",
    "flow_screenshot",
    "flow_cleanup",
    "flow_job_status",
    "flow_job_cancel",
    "flow_credits",
    "flow_create_character",
    "flow_create_scene",
    "flow_use_grid_architect",
    "flow_open_tools_gallery",
    "flow_discover_ui",
  ])
    assert(names.includes(name), name);
  for (const tool of listed.result.tools)
    assert.equal(tool.inputSchema.type, "object");
  const invalid = await rpc(3, "tools/call", {
    name: "flow_generate_video",
    arguments: { prompt: "p", duration: 5 },
  });
  assert.equal(invalid.result.isError, true);
  child.stdin.end();
});
