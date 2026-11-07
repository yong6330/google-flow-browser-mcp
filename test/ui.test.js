import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renameOpened, visibleTiles } from "../src/ui/assets.js";
import { selectors as S } from "../src/ui/selectors.js";
import { screenshot } from "../src/flow/files.js";
test("rename refuses a project title or mismatched caption without typing", async () => {
  let typed = false;
  const input = {
    filter() {
      return this;
    },
    count: async () => 1,
    inputValue: async () => "Project title",
    fill: async () => {
      typed = true;
    },
    press: async () => {},
  };
  const page = {
    url: () => "https://flow.google.com/project/a/edit/b",
    locator: () => input,
  };
  await assert.rejects(
    renameOpened(page, "Asset caption", "New name"),
    /refusing to type/,
  );
  assert(!typed);
  await assert.rejects(
    renameOpened(
      { ...page, url: () => "https://flow.google.com/project/a" },
      "Asset",
      "New",
    ),
    /Not in asset detail/,
  );
  assert(!typed);
});
test("tile extraction keeps both trash columns and never exposes signed URLs as IDs", async () => {
  const tile = (left) => ({
    getBoundingClientRect: () => ({ top: 10, left }),
    getAttribute: (key) => (key === "aria-label" ? `Card ${left}` : null),
    querySelector: (selector) =>
      selector === "video"
        ? {}
        : selector === S.progress
          ? null
          : selector === S.promptText
            ? { getAttribute: () => null, textContent: "Prompt" }
            : null,
    innerText: "Card",
  });
  const page = {
    locator: () => ({
      evaluateAll: async (fn, s) => fn([tile(0), tile(200)], s),
    }),
  };
  const tiles = await visibleTiles(page);
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].top, tiles[1].top);
  assert.notEqual(tiles[0].left, tiles[1].left);
  assert.equal(tiles[0].prompt, "Prompt");
  assert.equal(tiles[0].model, null);
  assert.equal(tiles[0].kind, "video");
});
test("screenshot uses short timeout and CDP fallback when Playwright fails", async (t) => {
  const base = path.resolve(".test-tmp");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "screenshot-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let fallback = false;
  const page = {
    screenshot: async (options) => {
      assert.equal(options.timeout, 3000);
      throw new Error("font timeout");
    },
    context: () => ({
      newCDPSession: async () => ({
        send: async (method) => {
          assert.equal(method, "Page.captureScreenshot");
          fallback = true;
          return { data: Buffer.from("png").toString("base64") };
        },
        detach: async () => {},
      }),
    }),
  };
  const result = await screenshot(page, "../safe", { dir });
  assert(fallback);
  assert.equal(path.dirname(result.file), dir);
  assert.equal(fs.readFileSync(result.file, "utf8"), "png");
});
