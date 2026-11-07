// UNVERIFIED-LIVE: browser-facing paths require the signed-in checks in docs/ARCHITECTURE.md.
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import {
  visibleTiles,
  scrollGrid,
  openTile,
  tileAction,
  renameOpened,
  uploadFiles,
} from "../ui/assets.js";
import { navigateSection, guard } from "../ui/actions.js";
import { ensureProject } from "./projects.js";
export const assetKey = (a) =>
  `${a.caption}:${createHash("sha256")
    .update(a.prompt || "")
    .digest("hex")
    .slice(0, 16)}`;
export async function scanAssets(
  page,
  { type = "all", include_trashed = false } = {},
) {
  await ensureProject(page);
  await guard(page);
  const sections = include_trashed ? ["all", "trash"] : ["all"];
  const found = [];
  for (const section of sections) {
    await navigateSection(page, section);
    await scrollGrid(page, 0);
    const seen = new Set();
    for (let step = 0; step < 10000; step++) {
      await page.waitForTimeout(150);
      const tiles = await visibleTiles(page);
      for (const tile of tiles) {
        // top AND left preserve both columns in the two-tiles-per-row trash view.
        const position = `${Math.round(tile.top)}:${Math.round(tile.left)}:${assetKey(tile)}`;
        if (seen.has(position)) continue;
        seen.add(position);
        const key = assetKey(tile);
        if (
          !found.some(
            (a) => a.key === key && a.trashed === (section === "trash"),
          )
        )
          found.push({ ...tile, key, trashed: section === "trash" });
      }
      const { before, after } = await scrollGrid(page, null);
      if (before === after) break;
      if (step === 9999)
        throw new Error(
          "Virtual grid did not reach its end; refusing an incomplete inventory",
        );
    }
  }
  return found
    .filter((a) => type === "all" || a.kind === type)
    .map(({ top, left, domIndex, text, ready, ...a }, index) => ({
      ...a,
      index,
    }));
}
export function matchAssets(assets, match) {
  let hits = assets.filter(
    (a) =>
      (match.key === undefined || a.key === match.key) &&
      (match.caption === undefined || a.caption === match.caption) &&
      (match.prompt === undefined || a.prompt === match.prompt) &&
      (match.index === undefined || a.index === match.index),
  );
  if (hits.length !== 1)
    throw new Error(
      `Asset match found ${hits.length} items. Supply caption + prompt or a key from flow_list_assets.`,
    );
  return hits[0];
}
export async function locateAsset(page, asset, action) {
  await navigateSection(page, asset.trashed ? "trash" : "all");
  await scrollGrid(page, 0);
  for (let i = 0; i < 10000; i++) {
    await page.waitForTimeout(150);
    const tiles = await visibleTiles(page);
    const hits = tiles.filter((t) => assetKey(t) === asset.key);
    if (hits.length > 1)
      throw new Error(
        "Identical caption/prompt assets are ambiguous; rename manually first.",
      );
    if (hits.length === 1) {
      await action(hits[0]);
      return;
    }
    const { before, after } = await scrollGrid(page, null);
    if (before === after) break;
  }
  throw new Error("Asset disappeared; refresh flow_list_assets");
}
export async function openAsset(page, match) {
  const assets = await scanAssets(page);
  const asset = matchAssets(assets, match);
  await locateAsset(page, asset, (t) => openTile(page, t.domIndex));
  return asset;
}
export async function renameAsset(page, args) {
  const asset = await openAsset(page, args.match);
  await renameOpened(page, asset.caption, args.name);
  await page.goto(page.url().split("/edit/")[0], {
    waitUntil: "domcontentloaded",
  });
  return { from: asset.caption, name: args.name };
}
export async function changeTrash(page, args, restore = false, signal) {
  const assets = await scanAssets(page, { include_trashed: restore });
  const targets = args.matches.map((m) =>
    matchAssets(
      assets.filter((a) => a.trashed === restore),
      m,
    ),
  );
  if (new Set(targets.map((a) => a.key)).size !== targets.length)
    throw new Error("Duplicate asset in match list; supply each asset once.");
  if (!args.confirm)
    return {
      dry_run: true,
      action: restore ? "restore" : "trash",
      assets: targets,
    };
  for (const asset of targets) {
    signal?.throwIfAborted();
    await guard(page);
    await locateAsset(page, asset, (t) =>
      tileAction(page, t.domIndex, restore ? "restore" : "trash"),
    );
    // Reload clears stale grid captions without clicking a toast that navigates to trash.
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  return {
    action: restore ? "restored" : "trashed",
    assets: targets.map((a) => a.key),
  };
}
export async function uploadMedia(page, args) {
  for (const file of args.paths)
    if (!fs.statSync(file).isFile())
      throw new Error(`Not a regular file: ${file}`);
  const existing = await scanAssets(page);
  const names = new Set(existing.map((a) => a.caption));
  const files = args.paths.filter(
    (file, i, all) =>
      !names.has(path.basename(file)) &&
      all.findIndex((f) => path.basename(f) === path.basename(file)) === i,
  );
  if (files.length) await uploadFiles(page, files);
  // UNVERIFIED-LIVE: upload ingestion is confirmed by an inventory readback, not a fixed sleep.
  const deadline = Date.now() + 120000;
  let uploaded = [];
  while (files.length && Date.now() < deadline) {
    const fresh = await scanAssets(page);
    uploaded = files
      .filter((f) => fresh.some((a) => a.caption === path.basename(f)))
      .map((f) => path.basename(f));
    if (uploaded.length === files.length) break;
    await page.waitForTimeout(2000);
  }
  if (uploaded.length !== files.length)
    throw new Error(
      "Upload ingestion could not be verified; inspect Flow before retrying.",
    );
  return {
    uploaded,
    skipped: args.paths
      .filter((f) => !files.includes(f))
      .map((f) => path.basename(f)),
  };
}
