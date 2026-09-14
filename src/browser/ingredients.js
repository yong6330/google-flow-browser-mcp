import { logger } from '../utils/logger.js';

/**
 * Attach project media (images, characters, clips) to the prompt box as
 * "소재" / ingredients.
 *
 * The upstream tool declared a `reference_images` parameter but never
 * implemented it, so every reference-dependent shot silently generated with no
 * references at all. Flow's picker lists everything already in the project by
 * name, so match on that instead of uploading files.
 */
const CHIP = '.ingredient-bar-container button.chip-container';
const PICKER_BTN = '[aria-label="프롬프트 상자에 소재 추가"]:visible';

/**
 * Clear whatever is covering the prompt bar.
 *
 * Two different leftovers block it and only one has a backdrop: the CDK
 * backdrop, and the asset picker panel itself, which renders with no backdrop
 * at all but still swallows every click aimed at the picker trigger. Checking
 * only the backdrop made closeOverlay return "clear" while the picker was
 * still open, which broke any cut with more than one reference.
 */
async function closeOverlay(page) {
  const covered = () => page.evaluate(() =>
    document.querySelectorAll('.cdk-overlay-backdrop-showing').length +
    document.querySelectorAll('.cdk-overlay-container button.asset-item').length +
    document.querySelectorAll('[aria-label="프롬프트 상자에 소재 추가"][aria-expanded="true"]').length);
  for (let i = 0; i < 8; i++) {
    if (await covered() === 0) return true;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(450);
  }
  await page.locator('.cdk-overlay-backdrop-showing').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
  return await covered() === 0;
}

/**
 * Remove every ingredient already attached to the prompt bar.
 *
 * Without this, calling the tool twice on the same staged prompt (a dry run
 * followed by the real generation) attaches each reference a second time.
 */
export async function clearIngredients(page) {
  await closeOverlay(page);
  for (let i = 0; i < 12; i++) {
    // Scope to the ingredient bar: .chip-container is also used by media cards
    // elsewhere on the page, and clicking one of those ATTACHES a reference.
    const n = await page.locator(CHIP).count();
    if (n === 0) return i;
    const removed = await page.evaluate(() => {
      const chip = document.querySelector('.ingredient-bar-container button.chip-container');
      if (!chip) return false;
      const x = [...chip.querySelectorAll('*')].find(e => (e.textContent || '').trim() === 'cancel');
      (x || chip).click();
      return true;
    });
    if (!removed) break;
    await page.waitForTimeout(500);
  }
  return -1;
}

export async function listIngredients(page) {
  const btn = page.locator(PICKER_BTN).first();
  if (!(await btn.count())) return [];
  await btn.click({ timeout: 8000 });
  await page.waitForTimeout(2000);
  const names = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button,[role=option],[role=menuitem]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const m = t.match(/^(.*)\s(이미지|동영상|캐릭터)$/);
      if (m) out.push({ name: m[1].trim(), kind: m[2] });
    });
    return out;
  });
  await closeOverlay(page);
  return names;
}

/**
 * @param {string[]} names  captions as shown in the picker. Matching is
 *   case-insensitive and prefix-based, because Flow truncates long captions
 *   with an ellipsis.
 */
export async function addIngredients(page, names = []) {
  await clearIngredients(page);
  const attached = [], missing = [];

  for (const wanted of names) {
    // The first open of the picker often races its search box, so give each
    // name two attempts before calling it missing.
    let clicked = false;
    for (let attempt = 0; attempt < 2 && !clicked; attempt++) {
    await closeOverlay(page);
    const btn = page.locator(PICKER_BTN).first();
    if (!(await btn.count())) continue;
    await btn.click({ timeout: 8000 });
    await page.waitForTimeout(2000);

    // The picker only renders a short recent list, so filter with its own
    // "애셋 검색" box before matching — otherwise anything older is invisible.
    const search = page.locator('input[aria-label="애셋 검색"]:visible, input[placeholder="애셋 검색"]:visible').first();
    if (await search.count()) {
      await search.click({ timeout: 5000 }).catch(() => {});
      await search.fill('').catch(() => {});
      await page.keyboard.insertText(wanted);
      await page.waitForTimeout(2000);
    }

    clicked = await page.evaluate((w) => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const target = norm(w);
      const cands = [...document.querySelectorAll('button,[role=option],[role=menuitem]')]
        .filter(el => el.getBoundingClientRect().width > 0)
        .map(el => ({ el, t: norm(el.innerText).replace(/\s(이미지|동영상|캐릭터)$/, '') }))
        .filter(c => c.t);
      let hit = cands.find(c => c.t === target);
      if (!hit) hit = cands.find(c => target.startsWith(c.t.replace(/…$/, '')) || c.t.startsWith(target));
      if (!hit) return false;
      hit.el.click();
      return true;
    }, wanted);

    await page.waitForTimeout(1100);
    await closeOverlay(page);
    }
    if (clicked) attached.push(wanted); else missing.push(wanted);
  }

  if (missing.length) logger.warn('Ingredients not found', { missing });
  logger.info('Ingredients attached', { attached });
  return { attached, missing };
}
