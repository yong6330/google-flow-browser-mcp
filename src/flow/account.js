import { connectionConfig } from "../browser/connect.js";
import { selectors as S, patterns } from "../ui/selectors.js";
import { control, guard, unique, settingsPanel } from "../ui/actions.js";
import { detectLanguage, parseNumber } from "../ui/strings.js";
import { config } from "../utils/config.js";
export async function accountInfo(
  page,
  expectedAccount = connectionConfig()?.expectedAccount ??
    config.expectedAccount,
) {
  await guard(page);
  // UNVERIFIED-LIVE: avatar and credit-balance placement vary by account tier.
  // The account panel ignores Escape, so an earlier call may have left it open.
  const openPanel = page.locator(S.accountPanel).filter({ visible: true });
  // A freshly opened tab renders the header late; wait for it before choosing a trigger.
  await page
    .locator(S.accountHeader)
    .or(openPanel)
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => {});
  const reuse = (await openPanel.count()) === 1;
  // Flow's own header button sits on top of the Google bar account link, so
  // it must be tried first or the click is intercepted.
  let trigger = reuse ? null : page.locator(S.accountHeader).filter({ visible: true });
  if (!reuse) {
    if ((await trigger.count()) !== 1)
      trigger = page.locator(S.account).filter({ visible: true });
    if ((await trigger.count()) !== 1)
      trigger = await control(page, "account", { optional: true });
    if (!trigger)
      trigger = page.locator(S.plan).filter({ hasText: patterns.plan });
    await (await unique(trigger, "account popover")).click();
  }
  try {
    // Wait for the account panel itself; a generic popover check can catch a
    // half-rendered or closing panel and read no email or balance.
    const panel = (await openPanel
      .first()
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false))
      ? openPanel
      : await settingsPanel(page);
    await panel
      .getByText(/@/)
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    const lang = await detectLanguage(page),
      text = await panel.innerText();
    const emails = [
      ...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []),
    ];
    const account = emails.length === 1 ? emails[0] : null;
    if (
      expectedAccount &&
      account?.toLowerCase() !== expectedAccount.toLowerCase()
    )
      throw new Error(
        "Expected account mismatch or signed-in email could not be verified.",
      );
    return {
      account,
      verified: expectedAccount ? true : null,
      credits: parseNumber(text, "balancePattern", lang),
      language: lang,
    };
  } finally {
    await page.keyboard.press("Escape");
    // Close only via the panel's close icon; never click sign-out controls.
    const stillOpen = page.locator(S.accountPanel).filter({ visible: true });
    if ((await stillOpen.count()) === 1)
      await stillOpen
        .locator("button")
        .filter({ hasText: /^close$/ })
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});
    await stillOpen.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }
}
export function checkCreditFloor(balance, cost, floor = 0, reserved = 0) {
  if (!Number.isFinite(balance) || !Number.isFinite(cost) || cost < 0)
    throw new Error("Credit balance/cost unavailable; refusing paid action.");
  if (balance - cost - reserved < floor)
    throw new Error(
      `Credit floor: ${balance} - ${cost} - ${reserved} reserved is below ${floor}.`,
    );
  return true;
}
