import { isFlowUrl } from "../browser/connect.js";
import { selectors as S, icons } from "./selectors.js";
import { lookup, detectLanguage, matches } from "./strings.js";
export async function unique(locator, label) {
  const visible = locator.filter({ visible: true });
  // Flow renders late after navigation: wait briefly for a first match before counting.
  await visible
    .first?.()
    .waitFor({ timeout: 8000 })
    .catch(() => {});
  const count = await visible.count();
  if (count !== 1)
    throw new Error(
      `UI changed: ${label} matched ${count} elements; refusing to guess.`,
    );
  return visible;
}
export async function control(
  page,
  key,
  { scope = page, role, optional = false, structural = true } = {},
) {
  if (structural && icons[key]) {
    const loc = scope
      .locator(S.buttons)
      .filter({ hasText: new RegExp(`^${icons[key]}$`) });
    if ((await loc.count()) === 1) return loc;
  }
  const lang = await detectLanguage(page);
  for (const label of lookup(key, lang)) {
    const candidates = role
      ? scope.getByRole(role, { name: label, exact: true })
      : scope
          .getByRole("button", { name: label, exact: true })
          .or(scope.getByRole("link", { name: label, exact: true }))
          .or(scope.getByRole("tab", { name: label, exact: true }))
          .or(scope.getByRole("radio", { name: label, exact: true }));
    const visible = candidates.filter({ visible: true });
    if ((await visible.count()) > 1)
      throw new Error(`Ambiguous ${key}; refusing to guess.`);
    if ((await visible.count()) === 1) return visible;
  }
  if (optional) return null;
  throw new Error(
    `UI changed: ${key} control missing. Use flow_discover_ui; extend uiStrings for this language.`,
  );
}
export async function click(page, key, options) {
  const el = await control(page, key, options);
  if (el) await el.click();
  return el;
}
// Flow buttons glue an icon ligature to the label ("crop_16_916:9") and model
// items add a caption ("12월 5일에 지원 중단 예정"). Compare the label alone,
// ignoring case, spaces and dashes ("Veo 3.1 Fast" == "Veo 3.1 - Fast").
export const normalizeLabel = (s) =>
  s.toLowerCase().replace(/[\s\-–—]+/g, "");
export async function exactOption(page, value, scope = page) {
  const all = scope.locator(S.options);
  await all.first().waitFor({ timeout: 8000 }).catch(() => {});
  const hits = await all.evaluateAll((els, v) => {
    const norm = (s) => s.toLowerCase().replace(/[\s\-–—]+/g, "");
    return els
      .map((e, i) => {
        if (!e.getBoundingClientRect().width) return -1;
        const c = e.cloneNode(true);
        c.querySelectorAll('mat-icon, [aria-hidden="true"], .caption').forEach((x) => x.remove());
        const label = c.querySelector(".label")?.textContent ?? c.textContent;
        return norm(label) === norm(v) ? i : -1;
      })
      .filter((i) => i >= 0);
  }, value);
  if (hits.length !== 1)
    throw new Error(`UI changed: ${value} matched ${hits.length} elements; refusing to guess.`);
  return all.nth(hits[0]);
}
export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function typePrompt(page, text) {
  const el = await unique(page.locator(S.prompt), "prompt");
  await el.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}
export async function guard(page) {
  const u = new URL(page.url());
  if (u.hostname === "accounts.google.com")
    throw new Error("Sign in manually in the dedicated visible Chrome window.");
  if (!isFlowUrl(page.url()))
    throw new Error("Refusing to interact with a non-Flow tab.");
  const lang = await detectLanguage(page);
  const text = await page.locator(S.body).innerText({ timeout: 3000 });
  // UNVERIFIED-LIVE: localized challenge detection is best-effort; never interact with verification UI.
  if (
    matches(text, "loginPattern", lang) ||
    (await page.locator(S.challenge).count())
  )
    throw new Error(
      "Login or verification required. Complete it manually; automation stopped.",
    );
}
export async function navigateSection(page, key) {
  await guard(page);
  const nav = await unique(page.locator(S.nav), "project navigation");
  await click(page, key, { scope: nav });
}
export async function discover(page) {
  return page
    .locator(
      'button, input, textarea, [contenteditable="true"], a, h1, h2, h3, [role="tab"], [role="radio"]',
    )
    .evaluateAll((els) =>
      els
        .filter((e) => e.getBoundingClientRect().width)
        .map((e) => ({
          tag: e.tagName,
          role: e.getAttribute("role"),
          text: (e.innerText || "").trim().slice(0, 160),
          aria: e.getAttribute("aria-label"),
          placeholder: e.getAttribute("placeholder"),
        })),
    );
}
export async function pickAsset(page, name) {
  // UNVERIFIED-LIVE: picker layout and name metadata can vary; ambiguous captions stop the job.
  const search = page.locator(S.search);
  let field = (await search.count()) === 1 ? search : null;
  if (!field)
    for (const label of lookup("searchAssets", await detectLanguage(page))) {
      const f = page
        .getByRole("textbox", { name: label, exact: true })
        .or(page.getByPlaceholder(label, { exact: true }));
      if ((await f.count()) === 1) {
        field = f;
        break;
      }
    }
  if (!field) throw new Error("Asset search missing");
  await field.fill(name);
  const candidates = page.locator(S.pickerItems).filter({ hasText: name });
  const item = await unique(candidates, `asset ${name}`);
  const text = (await item.innerText()).trim();
  const language = await detectLanguage(page);
  const kinds = ["image", "video", "characters"].flatMap((k) =>
    lookup(k, language),
  );
  if (
    ![
      name,
      ...kinds.map((k) => `${name} ${k}`),
      ...kinds.map((k) => `${name}\n${k}`),
    ].includes(text) &&
    (await item.getAttribute("aria-label")) !== name
  )
    throw new Error(
      "Picker caption is truncated or ambiguous; choose an exact unique name",
    );
  await item.click();
  await page.keyboard.press("Escape");
}
export async function attachReferences(page, args) {
  // Clear staged references before every call, including a confirmation of a dry run.
  for (let i = 0; i < 16; i++) {
    const chips = page.locator(S.ingredientChips);
    if (!(await chips.count())) break;
    await click(page, "cancel", { scope: chips.first() });
  }
  if (await page.locator(S.ingredientChips).count())
    throw new Error("Could not clear previous ingredients");
  if (args.mode === "frames" || args.mode === "text") {
    // UNVERIFIED-LIVE: stale frame slots must be empty before attaching a new frame or staging text-only video.
    for (const slot of ["start", "end"]) {
      const button = await control(page, slot);
      if (await button.locator(S.thumbnail).count())
        throw new Error(
          "A frame slot still has media. Clear it manually before staging this job.",
        );
    }
  }
  if (args.mode === "frames") {
    await click(page, "start");
    await pickAsset(page, args.start_image);
    if (args.end_image) {
      await click(page, "end");
      await pickAsset(page, args.end_image);
    }
  } else
    for (const name of args.reference_images || []) {
      await click(page, "addIngredient");
      await pickAsset(page, name);
    }
}
export async function openSettings(page) {
  const agent = await control(page, "agent", { optional: true });
  if (agent && (await agent.getAttribute("aria-pressed")) === "true")
    await agent.click();
  // Use icon/role first, then localized settings label; never click a generic popup button.
  await click(page, "settings");
}
export async function settingsPanel(page) {
  // The model menu opens a second overlay, so prefer the pane that holds the settings component.
  const settings = page.locator(S.settingsPanel);
  if ((await settings.count()) === 1) return settings;
  const overlay = page.locator(S.overlay);
  return (await overlay.count()) === 1
    ? overlay
    : unique(page.locator(S.popover), "settings popover");
}
async function assertSelected(el, label) {
  // Angular updates aria-checked a tick after the click: poll briefly.
  for (let i = 0; i < 20; i++) {
    const state =
      (await el.getAttribute("aria-checked")) ||
      (await el.getAttribute("aria-selected")) ||
      (await el.getAttribute("data-state"));
    if (["true", "checked"].includes(state)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Cannot verify setting ${label}`);
}
// Newer Flow builds use a slider; step it with the keyboard and read the label.
async function setDuration(page, panel, duration) {
  const slider = panel.locator(S.durationSlider);
  if (!(await slider.count())) {
    const el = await durationOption(page, panel, duration);
    await el.click();
    return assertSelected(el, "duration");
  }
  const read = async () =>
    Number((await panel.locator(S.durationValue).innerText()).match(/\d+/)?.[0]);
  await slider.focus();
  for (let i = 0; i < 40; i++) {
    const current = await read();
    if (current === duration) return;
    await page.keyboard.press(current < duration ? "ArrowRight" : "ArrowLeft");
    await page.waitForTimeout(100);
    if ((await read()) === current) break;
  }
  throw new Error(`Duration ${duration}s is not available for this model`);
}
async function checkDuration(page, panel, duration) {
  if (await panel.locator(S.durationSlider).count()) return setDuration(page, panel, duration);
  return assertSelected(await durationOption(page, panel, duration), "duration");
}
async function durationOption(page, panel, duration) {
  const suffixes = lookup("durationSuffix", await detectLanguage(page))
    .map(escapeRegex)
    .join("|");
  return unique(
    panel
      .locator(S.options)
      .filter({ hasText: new RegExp(`^${duration}\\s*(?:${suffixes})$`) }),
    "duration",
  );
}
export async function stageSettings(page, type, args) {
  // UNVERIFIED-LIVE: selected states and popup layout must be verified in a signed-in Flow UI.
  await openSettings(page);
  let panel = await settingsPanel(page);
  const mode = await control(page, type, { scope: panel, structural: false });
  await mode.click();
  await assertSelected(mode, type);
  // Pick the model first: it decides which ratio, length and resolution options exist.
  if (args.model) {
    const modelButton = () =>
      unique(panel.locator(S.modelButton), "model dropdown");
    await (await modelButton()).click();
    await (await exactOption(page, args.model, page.locator(S.menu))).click();
    await page
      .locator(S.menu)
      .first()
      .waitFor({ state: "hidden", timeout: 3000 })
      .catch(() => {});
    panel = await settingsPanel(page);
    if (
      !normalizeLabel(await (await modelButton()).innerText()).includes(
        normalizeLabel(args.model),
      )
    )
      throw new Error("Model selection did not persist");
  }
  const values = [args.ratio, `x${args.quantity}`, args.resolution].filter(
    Boolean,
  );
  for (const value of values) {
    const el = await exactOption(page, value, panel);
    await el.click();
    await assertSelected(el, value);
  }
  if (args.duration) await setDuration(page, panel, args.duration);
  if (type === "video")
    await click(page, args.mode === "text" ? "frames" : args.mode, {
      scope: panel,
    });
  // Model changes may reset mode, duration or quantity: re-read everything after selecting it.
  await assertSelected(
    await control(page, type, { scope: panel, structural: false }),
    type,
  );
  for (const value of values)
    await assertSelected(await exactOption(page, value, panel), value);
  if (args.duration) await checkDuration(page, panel, args.duration);
  if (type === "video")
    await assertSelected(
      await control(page, args.mode === "text" ? "frames" : args.mode, {
        scope: panel,
      }),
      args.mode,
    );
  return panel.innerText();
}
