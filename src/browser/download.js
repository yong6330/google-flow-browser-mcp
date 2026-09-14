import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { logger } from '../utils/logger.js';

/**
 * Save the newest generation to disk.
 *
 * The original implementation resolved media UUIDs against
 * labs.google/fx/api/trpc/... — Flow has since moved to flow.google.com, so
 * that lookup finds nothing and every run reported "no images detected" even
 * though generation had succeeded. Use the batch download button the result
 * card actually exposes instead; it hands back a zip of the batch.
 */
export async function downloadNewest(page, outDir, baseName) {
  fs.mkdirSync(outDir, { recursive: true });

  // Scope the control to ONE result card. A global .first() picks whichever
  // batch happens to be topmost, which silently downloads the wrong images.
  // The result card's caption element appears a few seconds after the images
  // render; locating too early is why this used to report "no images".
  let located = 'no results on page';
  for (let attempt = 0; attempt < 12; attempt++) {
    located = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.footer-title')];
      if (!labels.length) return 'no results on page';
      const label = labels[0]; // newest batch
      label.scrollIntoView({ block: 'center' });
      let node = label;
      for (let k = 0; k < 12 && node; k++) {
        const dls = node.querySelectorAll('[aria-label="일괄 다운로드"], [aria-label="다운로드"]');
        if (dls.length === 1) { window.__flowDl = dls[0]; return 'ok'; }
        if (dls.length > 1) return 'ambiguous';
        node = node.parentElement;
      }
      return 'no download control';
    });
    if (located === 'ok') break;
    await page.waitForTimeout(3000);
  }
  if (located !== 'ok') throw new Error('download control not found: ' + located);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.evaluate(() => window.__flowDl.click()),
  ]);

  const tmp = path.join(outDir, `.${baseName}.download`);
  await download.saveAs(tmp);

  const suggested = download.suggestedFilename() || '';
  const files = [];

  if (suggested.toLowerCase().endsWith('.zip') || isZip(tmp)) {
    const stage = path.join(outDir, `.${baseName}.unzip`);
    fs.rmSync(stage, { recursive: true, force: true });
    // ditto handles the non-ASCII filenames Flow puts in these zips; unzip does not.
    execFileSync('ditto', ['-x', '-k', tmp, stage]);
    const entries = fs.readdirSync(stage).filter(f => !f.startsWith('.')).sort();
    entries.forEach((f, i) => {
      const ext = path.extname(f) || '.jpeg';
      const dest = path.join(outDir, i === 0 ? `${baseName}${ext}` : `${baseName}_alt${i > 1 ? i : ''}${ext}`);
      fs.renameSync(path.join(stage, f), dest);
      files.push(dest);
    });
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(tmp, { force: true });
  } else {
    const ext = path.extname(suggested) || '.jpeg';
    const dest = path.join(outDir, `${baseName}${ext}`);
    fs.renameSync(tmp, dest);
    files.push(dest);
  }

  logger.info('Downloaded generation', { baseName, files });
  return files;
}

function isZip(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4b; // "PK"
  } catch { return false; }
}
