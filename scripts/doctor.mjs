#!/usr/bin/env node
import { doctor } from "../src/tools/registry.js";
try {
  console.log(JSON.stringify(await doctor(), null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
