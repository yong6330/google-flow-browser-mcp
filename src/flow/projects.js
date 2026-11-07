// UNVERIFIED-LIVE: browser-facing paths require the signed-in checks in docs/ARCHITECTURE.md.
import { config } from "../utils/config.js";
import { selectors as S } from "../ui/selectors.js";
import { click, unique, guard } from "../ui/actions.js";
import { isFlowUrl } from "../browser/connect.js";
export const projectId = (url) =>
  new URL(url).pathname.match(/\/project\/([^/]+)/)?.[1];
export async function projects(page, args) {
  await guard(page);
  if (!isFlowUrl(page.url())) throw new Error("Not a Flow page");
  if (args.action === "open" && args.id) {
    await page.goto(
      `https://flow.google.com/project/${encodeURIComponent(args.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    return { id: args.id, url: page.url() };
  }
  await page.goto(config.flowUrl, { waitUntil: "domcontentloaded" });
  await guard(page);
  await page
    .locator(S.projectLinks)
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  // The link text is a generic "open project" label; the name is in the card title.
  const list = await page.locator(S.projectLinks).evaluateAll((els) =>
    els
      .map((e) => ({
        name: (
          e.closest(".project-card")?.querySelector(".project-title-text")
            ?.innerText ||
          e.innerText ||
          e.getAttribute("aria-label") ||
          ""
        ).trim(),
        url: e.href,
      }))
      .filter((e, i, a) => a.findIndex((v) => v.url === e.url) === i),
  );
  if (args.action === "list")
    return list.map((p) => ({ ...p, id: projectId(p.url) }));
  if (args.action === "open") {
    const hits = list.filter((p) => p.name === args.name);
    if (hits.length !== 1)
      throw new Error("Project name missing or ambiguous; use id");
    if (!isFlowUrl(hits[0].url)) throw new Error("Invalid project URL");
    await page.goto(hits[0].url, { waitUntil: "domcontentloaded" });
    return hits[0];
  }
  // UNVERIFIED-LIVE: new project creation/name field need live verification.
  if (list.some((p) => p.name === args.name))
    throw new Error("Project name already exists; open it explicitly");
  await click(page, "newProject");
  await page.waitForURL(/\/project\//, { timeout: 15000 });
  const title = await unique(page.locator(S.title), "project title");
  await title.fill(args.name);
  await title.press("Enter");
  return { id: projectId(page.url()), url: page.url(), name: args.name };
}
export async function ensureProject(page, args = {}) {
  if (args.project_id || args.project_name)
    return projects(page, {
      action: "open",
      id: args.project_id,
      name: args.project_name,
    });
  if (!projectId(page.url()))
    throw new Error("Open or create a project with flow_projects first.");
  return {
    id: projectId(page.url()),
    url: page
      .url()
      .split("/edit/")[0]
      .replace(/\/(trash|character)$/, ""),
  };
}
