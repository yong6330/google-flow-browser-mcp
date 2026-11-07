import fs from "node:fs";
import { config } from "../utils/config.js";
export const dictionaries = Object.fromEntries(
  ["ko", "en", "fr", "ja"].map((l) => [
    l,
    JSON.parse(
      fs.readFileSync(new URL(`./strings/${l}.json`, import.meta.url), "utf8"),
    ),
  ]),
);
export function dictionary(language, overrides = config.uiStrings) {
  return { ...dictionaries[language], ...overrides[language] };
}
export function lookup(key, language = "en", overrides = config.uiStrings) {
  return [
    ...new Set(
      [
        language,
        ...Object.keys(overrides),
        ...Object.keys(dictionaries),
      ].flatMap((l) => {
        const v = dictionary(l, overrides)[key];
        return v === undefined ? [] : Array.isArray(v) ? v : [v];
      }),
    ),
  ];
}
export async function detectLanguage(page, overrides = config.uiStrings) {
  const lang = ((await page.locator("html").getAttribute("lang")) || "")
    .split("-")[0]
    .toLowerCase();
  if (dictionaries[lang] || overrides[lang]) return lang;
  const text = await page.locator("body").innerText({ timeout: 3000 });
  return (
    Object.keys({ ...dictionaries, ...overrides }).find((l) =>
      ["newProject", "addIngredient", "settings"].some((k) =>
        lookup(k, l, overrides)
          .slice(0, 1)
          .some((s) => text.includes(s)),
      ),
    ) || "en"
  );
}
export function parseNumber(text, key, language, overrides) {
  for (const source of lookup(key, language, overrides)) {
    const m = text.match(new RegExp(source, "i"));
    const value = m?.slice(1).find((v) => v !== undefined);
    if (value !== undefined) return Number(value.replaceAll(",", ""));
  }
  return null;
}
export function matches(text, key, language) {
  return lookup(key, language).some((s) => new RegExp(s, "i").test(text));
}
