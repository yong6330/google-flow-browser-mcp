// UNVERIFIED-LIVE: browser-facing paths require the signed-in checks in docs/ARCHITECTURE.md.
import fs from "node:fs";
import { selectors as S } from "../ui/selectors.js";
import {
  attachReferences,
  click,
  navigateSection,
  discover,
  typePrompt,
  exactOption,
  unique,
} from "../ui/actions.js";
import { lookup, detectLanguage } from "../ui/strings.js";
import { uploadMedia } from "./assets.js";
import { ensureProject } from "./projects.js";
export async function legacy(page, kind, args) {
  if (kind === "discover")
    return {
      url: page.url(),
      language: await detectLanguage(page),
      elements: await discover(page),
    };
  await ensureProject(page, args);
  const localReferences =
    kind === "grid" ? args.references : args.reference_images;
  if (localReferences?.length) {
    for (const file of localReferences)
      if (!file.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(file))
        throw new Error(
          "Character/grid reference_images must be absolute local paths",
        );
    await uploadMedia(page, { paths: localReferences });
  }
  const section =
    kind.includes("character") || kind === "import"
      ? "characters"
      : kind === "scene"
        ? "scenes"
        : "tools";
  await navigateSection(page, section);
  if (["characters", "gallery"].includes(kind))
    return { url: page.url(), elements: await discover(page) };
  // UNVERIFIED-LIVE: legacy character/scene/grid tool layouts are not covered by the field-tested notes.
  if (kind === "import") {
    const data = JSON.parse(fs.readFileSync(args.file_path, "utf8"));
    if (typeof data.description !== "string")
      throw new Error("Character JSON requires description");
    if (data.name !== undefined && typeof data.name !== "string")
      throw new Error("Invalid character name");
    args = { ...args, name: data.name, description: data.description };
  }
  if (["character", "import", "scene"].includes(kind)) {
    await click(page, kind === "scene" ? "newScene" : "newCharacter");
    await typePrompt(page, args.description || args.prompt);
    if (args.name) {
      const labels = lookup("name", await detectLanguage(page));
      let field;
      for (const label of labels) {
        const f = page.getByRole("textbox", { name: label, exact: true });
        if ((await f.count()) === 1) {
          field = f;
          break;
        }
      }
      if (!field) throw new Error("Character name field missing");
      await field.fill(args.name);
    }
  } else {
    const tool =
      kind === "grid"
        ? await import("../ui/actions.js").then((m) => m.control(page, "grid"))
        : await unique(
            page
              .getByRole("button", { name: args.tool_name, exact: true })
              .or(
                page.getByRole("link", { name: args.tool_name, exact: true }),
              ),
            args.tool_name,
          );
    await tool.click();
    if (kind === "grid") {
      await typePrompt(page, args.theme_prompt);
      for (const value of [args.engine, args.ratio, args.visual_logic].filter(
        Boolean,
      ))
        await (await exactOption(page, value)).click();
      const textareas = page.locator(S.prompt);
      for (let i = 0; i < (args.shot_prompts || []).length; i++) {
        if ((await textareas.count()) <= i + 1)
          throw new Error("Shot prompt fields missing");
        const input = textareas.nth(i + 1);
        await input.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText(args.shot_prompts[i]);
      }
    } else
      for (const [key, value] of Object.entries(args.params || {}))
        await (
          await unique(
            page.getByRole("textbox", { name: key, exact: true }),
            key,
          )
        ).fill(value);
  }
  const referenceNames = (localReferences || []).map((f) =>
    f.split(/[\\/]/).pop(),
  );
  const names = kind === "scene" ? args.characters || [] : referenceNames;
  if (names.length) await attachReferences(page, { reference_images: names });
  return {
    status: "ready_for_confirmation",
    settings: args,
    url: page.url(),
    note: "Staged only. No paid action submitted.",
    elements: await discover(page),
  };
}
