import { logger } from '../utils/logger.js';
import { get } from '../utils/config.js';

/**
 * Flow's prompt bar has an explicit output-mode control — the chip labelled
 * "동영상 · 720p · 8초" (aria-label "설정 트리거") opens a panel with 이미지 /
 * 동영상 radios plus aspect-ratio radios.
 *
 * The original code assumed mode was implied by the selected model and never
 * touched this control, so an image request would submit in video mode.
 */
const MODE_LABEL = { image: '이미지', video: '동영상' };

/**
 * The prompt bar ships with the "에이전트" toggle ON. In that state Flow hands the
 * prompt to an agent that rewrites it, and the direct output-settings chip stays
 * hidden. This project needs prompts used verbatim, so turn it off.
 */
export async function disableAgentMode(page) {
  const btn = page.locator('button:visible').filter({ hasText: /^에이전트$/ }).first();
  if (!(await btn.count())) return false;
  if ((await btn.getAttribute('aria-pressed')) !== 'true') return false;
  await btn.click({ timeout: 6000 });
  await page.waitForTimeout(800);
  logger.info('Agent mode disabled');
  return true;
}

async function openPanel(page) {
  await disableAgentMode(page);
  const chip = page.locator('[aria-label="설정 트리거"]:visible').first();
  if (!(await chip.count())) return false;
  const before = await page.locator('[role=radio]:visible').count();
  await chip.click({ timeout: 8000 });
  await page.waitForTimeout(900);
  // panel is open once extra radios appeared
  return (await page.locator('[role=radio]:visible').count()) > before;
}

async function pickRadio(page, text) {
  const r = page.locator('[role=radio]:visible').filter({ hasText: text }).first();
  if (!(await r.count())) {
    logger.warn('Radio not found', { text });
    return false;
  }
  await r.click({ timeout: 6000 });
  await page.waitForTimeout(600);
  return true;
}

export async function readModeChip(page) {
  const chip = page.locator('[aria-label="설정 트리거"]:visible').first();
  if (!(await chip.count())) return null;
  return (await chip.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

/**
 * Force the prompt bar into `mode` ('image' | 'video') and, when given, set the
 * aspect ratio. Returns the chip text afterwards so callers can assert.
 */
export async function ensureOutputMode(page, mode, ratio, count, res) {
  const want = MODE_LABEL[mode];
  if (!want) throw new Error(`unknown mode: ${mode}`);

  const opened = await openPanel(page);
  if (!opened) {
    logger.warn('Could not open the output-settings panel');
    return await readModeChip(page);
  }

  await pickRadio(page, want);
  if (ratio) await pickRadio(page, ratio);
  // outputs per generation — x2 is the default and doubles the credit cost
  if (count) await pickRadio(page, `x${count}`);
  // resolution (Omni only): 360p costs half of 720p per clip
  if (res) await pickRadio(page, res);

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(700);

  let chip = await readModeChip(page);
  // the radios sometimes don't register on the first pass — verify and retry once
  if (chip && ((count && !chip.includes(`x${count}`)) || (res && !chip.includes(res)))) {
    if (await openPanel(page)) {
      if (count) await pickRadio(page, `x${count}`);
      if (res) await pickRadio(page, res);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(700);
      chip = await readModeChip(page);
    }
  }
  logger.info('Output mode set', { mode, ratio, count, res, chip });
  return chip;
}

/**
 * Throw unless the chip actually reflects the mode we asked for. The chip shows
 * the selected model, so check it against the configured model lists rather than
 * just the words 이미지/동영상.
 */
export async function assertMode(page, mode) {
  const chip = (await readModeChip(page)) || '';
  const imageNames = Object.keys(get('imageModels', {}));
  const videoNames = Object.keys(get('videoModels', {}));
  const looksVideo = chip.includes('동영상') || videoNames.some(n => chip.includes(n));
  const looksImage = chip.includes('이미지') || imageNames.some(n => chip.includes(n));

  if (mode === 'image' && (looksVideo || !looksImage)) {
    throw new Error(`Output chip reads "${chip}" — not image mode. Refusing to spend credits.`);
  }
  if (mode === 'video' && (looksImage || !looksVideo)) {
    throw new Error(`Output chip reads "${chip}" — not video mode. Refusing to spend credits.`);
  }
  return chip;
}
