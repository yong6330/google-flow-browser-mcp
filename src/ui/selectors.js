// All Flow DOM selectors and icon ligatures live here. Fail on ambiguity.
export const selectors = {
  overlay: ".cdk-overlay-pane:visible",
  challenge: 'iframe[src*="recaptcha"]:visible, iframe[src*="captcha"]:visible',
  fileInput: 'input[type="file"]',
  body: "body",
  prompt: '[contenteditable="true"]:visible, textarea:visible',
  scroller: ".cdk-virtual-scrollable.page-container",
  tiles: "flow-grid-tile-container",
  title: "input.editable-text-input:visible",
  thumbnail: "img, video",
  nav: 'nav, [role="navigation"], [class*="sidebar"]',
  settings: "button[aria-haspopup]:visible",
  popover:
    '[role="dialog"]:visible, [role="menu"]:visible, .cdk-overlay-pane:visible',
  options:
    '[role="radio"]:visible, [role="tab"]:visible, [role="option"]:visible, [role="menuitem"]:visible, button:visible',
  selected:
    '[aria-checked="true"], [aria-selected="true"], [data-state="checked"]',
  pickerItems: 'button.asset-item:visible, [role="option"]:visible',
  search: 'input[type="search"]:visible, [role="searchbox"]:visible',
  ingredientChips: ".ingredient-bar-container button.chip-container",
  buttons: 'button:visible, [role="button"]:visible',
  projectLinks: 'a[href*="/project/"]',
  promptText: '[data-prompt], .prompt-text, [class*="prompt"]',
  model: '[data-model], [class*="model"]',
  duration: '[data-duration], [class*="duration"]',
  resolution: '[data-resolution], [class*="resolution"]',
  created: "time, [data-created]",
  progress: '[role="progressbar"], [aria-busy="true"]',
  account:
    '[data-account-email], [aria-label*="@"], [data-testid="account-menu"], [data-test-id="account"]',
  plan: "button",
  inputs: 'input:visible, textarea:visible, [contenteditable="true"]:visible',
};
export const icons = {
  generate: "arrow_forward",
  download: "download",
  trash: "delete",
  restore: "restore",
  addIngredient: "add",
  cancel: "cancel",
  newProject: "add_2",
  account: "account_circle",
  settings: "tune",
};

export const patterns = { plan: /^(PRO|ULTRA)$/ };
