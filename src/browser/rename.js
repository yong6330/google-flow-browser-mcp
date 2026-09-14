import { logger } from '../utils/logger.js';

/**
 * Rename a generated asset.
 *
 * Flow only exposes renaming inside the media detail view: open the item, then
 * edit the title at the top-left. That title field shares its class with the
 * PROJECT title on the grid view, so this refuses to type unless the field
 * already holds the caption we opened — otherwise a miss would silently rename
 * the whole project.
 */
export async function renameMedia(page, caption, newName) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  const opened = await page.evaluate((cap) => {
    const label = [...document.querySelectorAll('.footer-title')]
      .find(e => (e.textContent || '').trim() === cap);
    if (!label) return false;
    let card = label;
    for (let i = 0; i < 8 && card; i++) { if (card.querySelector('img')) break; card = card.parentElement; }
    const img = card && card.querySelector('img');
    if (!img) return false;
    img.click();
    return true;
  }, caption);
  if (!opened) throw new Error(`media not found on the grid: ${caption}`);
  await page.waitForTimeout(2500);

  const field = page.locator('input.editable-text-input:visible').first();
  if (!(await field.count())) throw new Error('rename field not found in detail view');

  const current = (await field.inputValue().catch(() => '')).trim();
  if (current !== caption.trim()) {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error(`refusing to rename: field holds "${current}", expected "${caption}"`);
  }

  await field.click({ timeout: 6000 });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(newName);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  const after = (await field.inputValue().catch(() => '')).trim();
  logger.info('Renamed media', { from: caption, to: after });

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1200);
  return after;
}
