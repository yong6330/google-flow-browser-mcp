import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * Upload local image files into the Flow project so they can be attached as
 * 소재 references. Flow's picker has a "미디어 업로드" button that opens a native
 * file chooser; Playwright intercepts that rather than the OS dialog.
 */
export async function uploadMedia(page, filePaths = []) {
  const files = filePaths.filter(f => fs.existsSync(f));
  if (!files.length) throw new Error('no existing files to upload');

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(600);

  const picker = page.locator('[aria-label="프롬프트 상자에 소재 추가"]:visible').first();
  if (!(await picker.count())) throw new Error('ingredient picker button not found');
  await picker.click({ timeout: 8000 });
  await page.waitForTimeout(1400);

  const uploadBtn = page.locator('button:visible, [role=menuitem]:visible')
    .filter({ hasText: '미디어 업로드' }).first();
  if (!(await uploadBtn.count())) throw new Error('"미디어 업로드" button not found');

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 20000 }),
    uploadBtn.click({ timeout: 8000 }),
  ]);
  await chooser.setFiles(files);
  logger.info('Uploading media to Flow', { files: files.map(f => path.basename(f)) });

  // give Flow time to ingest; it shows the new items in the picker afterwards
  await page.waitForTimeout(8000);
  for (let i = 0; i < 20; i++) {
    const busy = await page.evaluate(() =>
      /업로드 중|uploading|처리 중/i.test(document.body.innerText)).catch(() => false);
    if (!busy) break;
    await page.waitForTimeout(3000);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1000);
  return files.map(f => path.basename(f));
}
