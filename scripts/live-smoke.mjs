#!/usr/bin/env node
// Manual only: launches a real visible browser. Credits require the explicit --spend flag.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
function value(flag) {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
}
if (args.includes("--help")) {
  console.log(
    "node scripts/live-smoke.mjs [--project ID] [--prompt TEXT] [--spend] [--download]\nWithout --project: connect, doctor, project inventory only. With --project: also scan assets and stage an image. --spend explicitly submits one paid image.",
  );
  process.exit(0);
}
if (args.includes("--spend") && !value("--project"))
  throw new Error("--spend requires --project ID");
const client = new Client({ name: "flow-manual-smoke", version: "2.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../src/index.js", import.meta.url))],
  stderr: "inherit",
});
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const result = JSON.parse(r.content[0].text);
  console.log(name, JSON.stringify(result, null, 2));
  if (r.isError) throw new Error(result.error);
  return result;
}
try {
  await client.connect(transport);
  const connected = await call("flow_connect");
  if (connected.status !== "connected")
    throw new Error(
      "Complete manual sign-in in the dedicated window, then run this script again.",
    );
  await call("flow_doctor");
  await call("flow_projects", { action: "list" });
  if (value("--project")) {
    await call("flow_projects", { action: "open", id: value("--project") });
    await call("flow_list_assets");
    const job = await call("flow_generate_image", {
      prompt: value("--prompt") || "A small ceramic cup on a wooden table",
      quantity: 1,
      confirm: args.includes("--spend"),
      wait: true,
      download: args.includes("--download"),
    });
    if (job.status !== "completed")
      throw new Error(
        `Job ${job.id}: ${job.status}; inspect flow_job_status before retrying`,
      );
    if (!args.includes("--spend") && !job.result?.dry_run)
      throw new Error("Expected a dry run");
  }
  await call("flow_disconnect");
} finally {
  await client.close();
}
