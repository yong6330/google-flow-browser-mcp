import { connectionConfig } from "../browser/connect.js";
import { selectors as S, patterns } from "../ui/selectors.js";
import { control, guard, unique } from "../ui/actions.js";
import { detectLanguage, parseNumber } from "../ui/strings.js";
import { config } from "../utils/config.js";
export async function accountInfo(
  page,
  expectedAccount = connectionConfig()?.expectedAccount ??
    config.expectedAccount,
) {
  await guard(page);
  // UNVERIFIED-LIVE: avatar and credit-balance placement vary by account tier.
  let trigger = page.locator(S.account).filter({ visible: true });
  if ((await trigger.count()) !== 1)
    trigger = await control(page, "account", { optional: true });
  if (!trigger)
    trigger = page.locator(S.plan).filter({ hasText: patterns.plan });
  await (await unique(trigger, "account popover")).click();
  try {
    const panel = await import("../ui/actions.js").then((m) =>
      m.settingsPanel(page),
    );
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
