import { logger } from '../utils/logger.js';
import { getPage } from '../browser/connect.js';
import { ensureOutputMode, assertMode } from '../browser/output-mode.js';
import { addIngredients } from '../browser/ingredients.js';
import { downloadNewest } from '../browser/download.js';
import { jobQueue } from '../queue/job-queue.js';
import { FlowError, ErrorCodes } from '../utils/errors.js';
import { takeScreenshot } from '../utils/screenshots.js';
import { detectPageElements, fastType } from '../browser/safe-actions.js';
import { prepareDownload, findNewFiles, saveMetadata } from '../utils/file-manager.js';
import { ensureProjectInContext, navigateToSidebar } from '../navigation/project-navigator.js';
import { get } from '../utils/config.js';
import fs from 'fs';
import path from 'path';

function selectVideoModel(requested) {
  const available = get('videoModels', {});
  if (!requested || requested === 'auto') {
    return 'Veo 3.1 - Fast';
  }
  if (requested === 'quality' || requested === 'premium') return 'Veo 3.1 - Quality';
  if (requested === 'fast' || requested === 'speed') return 'Veo 3.1 - Fast';
  if (requested === 'lite' || requested === 'test') return 'Veo 3.1 - Lite';
  if (requested === 'flash' || requested === 'simple') return 'Omni Flash';
  if (available[requested]) return requested;
  return null;
}

export async function handleGenerateVideo(args) {
  const job = jobQueue.createJob('video_generation', {
    prompt: args.prompt,
    model: args.model || 'auto',
    ratio: args.ratio || '16:9',
    duration: args.duration || '4s',
    quantity: args.quantity || 1,
    outputFolder: args.output_folder,
    useCharacter: args.use_character,
    useScene: args.use_scene,
    references: args.references,
    ingredients: args.ingredients,
    project_name: args.project_name,
    campaign: args.campaign,
  });

  try {
    jobQueue.startJob(job.id);
    const page = getPage();

    // Ensure we're in a project context
    await ensureProjectInContext(page, {
      name: args.project_name,
      campaign: args.campaign,
    });

    // Select model
    const model = selectVideoModel(args.model);
    if (!model) {
      const available = Object.keys(get('videoModels', {}));
      throw new FlowError(ErrorCodes.MODEL_NOT_AVAILABLE,
        `Video model "${args.model}" not available. Available: ${available.join(', ')}`,
        { requested: args.model, available });
    }
    logger.info('Using video model', { model });

    // Try to find video UI — look for textarea, selectors, etc.
    const elements = await detectPageElements(page);
    logger.info('Page elements in project for video', {
      buttons: elements.buttons.length,
      inputs: elements.inputs.length,
    });

    // Find prompt input — try current view first, then navigate sidebar
    let promptInput = null;
    const promptCandidates = [
      page.locator('textarea:visible, [contenteditable="true"]:visible').first(),
      page.locator('textarea').first(),
      page.locator('[contenteditable="true"]').first(),
    ];

    for (const candidate of promptCandidates) {
      if (await candidate.isVisible().catch(() => false)) {
        promptInput = candidate;
        break;
      }
    }

    if (!promptInput) {
      logger.info('No prompt found on current view, trying sidebar navigation');
      await navigateToSidebar(page, 'Outils');
      await page.waitForTimeout(2000);

      for (const candidate of promptCandidates) {
        if (await candidate.isVisible().catch(() => false)) {
          promptInput = candidate;
          break;
        }
      }
    }

    if (!promptInput) {
      await takeScreenshot(page, 'no-prompt-input-video');
      throw new FlowError(ErrorCodes.UNKNOWN_UI_CHANGE, 'Could not find prompt input for video');
    }

    // Model selection dropdown
    try {
      const modelLocator = page.locator('button:has-text("Omni"), button:has-text("Veo"), [class*="model"] button').first();
      if (await modelLocator.isVisible().catch(() => false)) {
        await modelLocator.click();
        await page.waitForTimeout(500);
        const optLocator = page.locator(`text="${model}"`).first();
        if (await optLocator.isVisible().catch(() => false)) {
          await optLocator.click();
          await page.waitForTimeout(500);
        } else {
          await page.keyboard.press('Escape');
        }
      }
    } catch (err) {
      logger.warn('Could not select video model', { error: err.message });
    }

    // Select ratio
    const ratios = get('videoRatios', ['9:16', '16:9']);
    const ratio = args.ratio || '16:9';
    if (!ratios.includes(ratio)) {
      throw new FlowError(ErrorCodes.RATIO_NOT_AVAILABLE, `Ratio ${ratio} not available for video`);
    }
    try {
      const ratioBtn = page.locator(`button:has-text("${ratio}")`).first();
      if (await ratioBtn.isVisible().catch(() => false)) {
        await ratioBtn.click();
        await page.waitForTimeout(500);
      }
    } catch { /* ok */ }

    // Select duration
    const durations = get('durations', ['4s', '6s', '8s', '10s']);
    const duration = args.duration || '4s';
    if (!durations.includes(duration)) {
      logger.warn('Duration not available, using 4s', { requested: duration });
    }
    try {
      const durBtn = page.locator(`button:has-text("${duration}")`).first();
      if (await durBtn.isVisible().catch(() => false)) {
        await durBtn.click();
        await page.waitForTimeout(500);
      }
    } catch { /* ok */ }

    // Select quantity
    const qty = Math.min(Math.max(args.quantity || 1, 1), 4);
    try {
      const qtyBtn = page.locator(`button:has-text("x${qty}")`).first();
      if (await qtyBtn.isVisible().catch(() => false)) {
        await qtyBtn.click();
        await page.waitForTimeout(500);
      }
    } catch { /* ok */ }

    // Fill prompt
    await promptInput.click();
    await promptInput.fill('');
    await page.waitForTimeout(200);
    // Flow's prompt bar keeps its own output mode; set it before typing.
    await ensureOutputMode(page, 'video', args.ratio);

    await fastType(promptInput, args.prompt);
    await page.waitForTimeout(500);

    // Attach the still that this clip animates (and any other references) as 소재.
    let referencesAttached = { attached: [], missing: [] };
    if (Array.isArray(args.reference_images) && args.reference_images.length) {
      referencesAttached = await addIngredients(page, args.reference_images);
    }

    if (args.auto_confirm === true) {
      await assertMode(page, 'video');
      await takeScreenshot(page, 'video-pre-generate');

      const genBtn = page.locator('[aria-label="생성 시작"]:visible, button:has-text("arrow_forward"):visible').first();
      if (!(await genBtn.count())) throw new FlowError(ErrorCodes.GENERATION_BUTTON_DISABLED, 'Generate button not found');
      await genBtn.click({ timeout: 10000 });
      logger.info('Video generation started', { model, ratio, duration });

      // Clips take far longer than stills; poll for the result card to settle.
      const waitMs = Number(get('videoWaitMs', 420000));
      const started = Date.now();
      let settled = false;
      while (Date.now() - started < waitMs) {
        await page.waitForTimeout(10000);
        const busy = await page.evaluate(() =>
          /생성 중|처리 중|generating/i.test(document.body.innerText)).catch(() => false);
        if (!busy) { settled = true; break; }
      }
      logger.info('Video wait finished', { settled, seconds: Math.round((Date.now() - started) / 1000) });
      await page.waitForTimeout(6000);

      const quotaHit = await page.evaluate(() => {
      // Scope the check to the NEWEST result card only. Scanning the whole page
      // re-reads stale failure cards from earlier runs and blocks good runs.
      const cards = [...document.querySelectorAll('[class*="result"], [class*="generation"], [class*="batch"]')]
        .filter(el => el.getBoundingClientRect().width > 0);
      const scope = cards.length ? cards[0] : null;
      const t = (scope ? scope.innerText : '') || '';
      return /사용량 한도에 도달|usage limit|quota/i.test(t) && /실패|failed/i.test(t);
      }).catch(() => false);
      if (quotaHit) {
        await takeScreenshot(page, 'quota-limit');
        throw new FlowError(ErrorCodes.GENERATION_BUTTON_DISABLED,
          'Flow reports 사용량 한도에 도달했습니다 (usage limit reached). Nothing was charged.');
      }

      const baseName = args.name || `clip_${job.id}`;
      const outputDir = args.output_folder || prepareDownload('video', model, job.id).dir;
      let downloadedFiles = [];
      try {
        downloadedFiles = await downloadNewest(page, outputDir, baseName);
      } catch (err) {
        logger.warn('Video download failed; the clip still exists in the project', { error: err.message });
      }

      saveMetadata(job.id, { type: 'video', model, ratio, duration, prompt: args.prompt,
                             references: referencesAttached, files: downloadedFiles });
      jobQueue.completeJob(job.id, {
        status: 'success', type: 'video', model_used: model, ratio, duration,
        references: referencesAttached, files: downloadedFiles,
        clip_count: downloadedFiles.length, credits_consumed: true,
      });
      return jobQueue.getJob(job.id).result;
    }

    // Default: set up only. Video generation costs credits.
    logger.info('Video generation setup complete — not clicking generate (paid feature)');
    await takeScreenshot(page, 'video-ready-to-generate');

    saveMetadata(job.id, {
      type: 'video',
      model,
      ratio,
      duration,
      quantity: qty,
      prompt: args.prompt,
      status: 'ready_for_confirmation',
      note: 'Video generation is a paid feature. Manual confirmation required to proceed.',
    });

    jobQueue.completeJob(job.id, {
      status: 'ready_for_confirmation',
      type: 'video',
      account: get('expectedAccount'),
      model_used: model,
      ratio,
      duration,
      quantity: qty,
      prompt: args.prompt,
      message: 'Video generation setup complete. Manual confirmation required (uses credits).',
      screenshot: await takeScreenshot(page, 'video-ready'),
    });

    return jobQueue.getJob(job.id).result;
  } catch (err) {
    await takeScreenshot(getPage(), 'generate-video-error');
    jobQueue.failJob(job.id, err);
    throw err;
  }
}
