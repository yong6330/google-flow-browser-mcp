import fs from "node:fs";
import path from "node:path";
import { dataPaths } from "./config.js";
function log(level, message, data) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...data,
  });
  process.stderr.write(line + "\n");
  try {
    const dir = dataPaths().logs;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(
      path.join(dir, `flow-${new Date().toISOString().slice(0, 10)}.log`),
      line + "\n",
      { mode: 0o600 },
    );
  } catch {
    /* stderr remains available */
  }
}
export const logger = Object.fromEntries(
  ["info", "warn", "error", "debug"].map((level) => [
    level,
    (message, data = {}) => log(level, message, data),
  ]),
);
