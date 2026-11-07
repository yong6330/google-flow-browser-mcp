import fs from "node:fs";
import path from "node:path";
import { dataPaths } from "../utils/config.js";
// A single MCP process owns a data directory; avoids cross-client paid submissions racing.
export function acquireServerLock(dir = dataPaths().state) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "server.lock");
  const write = () =>
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid }), {
      flag: "wx",
      mode: 0o600,
    });
  try {
    write();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let pid;
    try {
      pid = JSON.parse(fs.readFileSync(file, "utf8")).pid;
    } catch {
      throw new Error(
        "Unreadable server.lock; verify no MCP server is using this data directory before removing it.",
      );
    }
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error("Invalid server.lock; inspect it manually.");
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") alive = false;
    }
    if (alive)
      throw new Error(
        "Another MCP server owns this data directory. Close it first or use a separate FLOW_MCP_HOME.",
      );
    fs.unlinkSync(file);
    write();
  }
  const release = () => {
    try {
      if (JSON.parse(fs.readFileSync(file, "utf8")).pid === process.pid)
        fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  };
  process.once("exit", release);
  return release;
}
