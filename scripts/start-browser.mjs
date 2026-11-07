#!/usr/bin/env node
import { launchBrowser } from "../src/browser/connect.js";
try {
  const r = await launchBrowser();
  console.error(
    `Dedicated Chrome ready on port ${r.port}. Sign in to Flow once in this window. Keep the profile private.`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
