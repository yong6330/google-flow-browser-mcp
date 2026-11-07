// UNVERIFIED-LIVE: browser-facing paths require the signed-in checks in docs/ARCHITECTURE.md.
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dataPaths } from "../utils/config.js";
const exec = promisify(execFile);
export function outputDir(folder) {
  if (folder && !path.isAbsolute(folder))
    throw new Error("output_folder must be absolute");
  const dir = folder || dataPaths().outputs;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
export const safeName = (name) =>
  path
    .basename(name.replaceAll("\\", "/"))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 160) || "asset";
export async function saveDownload(download, folder) {
  const dir = outputDir(folder),
    id = randomUUID();
  const target = path.join(
    dir,
    `${id}_${safeName(download.suggestedFilename())}`,
  );
  for (let i = 0; i < 3; i++) {
    try {
      await download.saveAs(target);
      break;
    } catch (e) {
      if ((e.code !== "ENOENT" && !e.message.includes("ENOENT")) || i === 2)
        throw e;
      fs.mkdirSync(dir, { recursive: true });
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const buf = fs.readFileSync(target);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return [target];
  // Archive names are never used as paths: no traversal, no collision, Unicode preserved.
  let expanded = 0;
  const entries = unzipSync(buf, {
    filter: (entry) => {
      expanded += entry.originalSize;
      if (expanded > 512 * 1024 ** 2)
        throw new Error(
          "ZIP exceeds 512 MiB extraction limit; original archive preserved",
        );
      return true;
    },
  });
  const files = [];
  for (const [name, bytes] of Object.entries(entries))
    if (bytes.length && /\.(mp4|webm|png|jpe?g|gif)$/i.test(name)) {
      const dest = path.join(dir, `${id}_${files.length}_${safeName(name)}`);
      fs.writeFileSync(dest, bytes, { flag: "wx", mode: 0o600 });
      files.push(dest);
    }
  if (!files.length)
    throw new Error(
      "ZIP contained no supported media; original archive preserved",
    );
  return files;
}
export async function verifyFile(file, { resolution, compare_with } = {}) {
  const stat = fs.statSync(file);
  if (!stat.size) throw new Error("Empty download");
  const result = {
    file,
    size: stat.size,
    sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  };
  if (/\.(png|jpe?g|gif)$/i.test(file)) return result;
  try {
    const { stdout } = await exec(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { timeout: 30000, maxBuffer: 4 * 1024 ** 2 },
    );
    const probe = JSON.parse(stdout),
      video = probe.streams.find((s) => s.codec_type === "video");
    if (!video) throw new Error("No video stream");
    result.media = {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      duration: Number(probe.format.duration || video.duration),
    };
    const min = resolution === "4k" ? 2160 : resolution === "1080p" ? 1080 : 0;
    if (min && Math.min(video.width, video.height) < min)
      throw new Error(`Downloaded dimensions below ${resolution}`);
    if (!Number.isFinite(result.media.duration) || result.media.duration <= 0)
      throw new Error("Invalid video duration");
  } catch (e) {
    if (e.code === "ENOENT")
      result.verification = "ffprobe unavailable; size and hash only";
    else throw e;
  }
  if (compare_with) {
    // UNVERIFIED-LIVE: SSIM compares aligned decoded frames; cuts/timing differences affect the score.
    const other = fs.statSync(compare_with);
    if (!other.isFile()) throw new Error("compare_with is not a file");
    try {
      const { stderr } = await exec(
        "ffmpeg",
        [
          "-v",
          "info",
          "-i",
          file,
          "-i",
          compare_with,
          "-filter_complex",
          "[0:v]scale=320:180,setsar=1,setpts=PTS-STARTPTS[a];[1:v]scale=320:180,setsar=1,setpts=PTS-STARTPTS[b];[a][b]ssim=shortest=1",
          "-an",
          "-f",
          "null",
          "-",
        ],
        { timeout: 60000, maxBuffer: 4 * 1024 ** 2 },
      );
      const m = stderr.match(/All:([\d.]+)/);
      result.similarity = { method: "SSIM", score: m ? Number(m[1]) : null };
    } catch (e) {
      if (e.code === "ENOENT")
        result.similarity = { unavailable: "ffmpeg not installed" };
      else throw e;
    }
  }
  return result;
}
export function cleanup(
  { older_than_days = 7, confirm = false } = {},
  { dirs = dataPaths(), now = Date.now() } = {},
) {
  const cutoff = now - older_than_days * 86400000,
    files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(f);
      else if (entry.isFile() && fs.lstatSync(f).mtimeMs < cutoff)
        files.push(f);
    }
  }
  for (const key of ["screenshots", "logs", "temp"]) walk(dirs[key]);
  if (confirm) for (const f of files) fs.unlinkSync(f);
  return { dry_run: !confirm, files };
}
export async function screenshot(
  page,
  name = "manual",
  { dir = dataPaths().screenshots } = {},
) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${Date.now()}_${safeName(name)}.png`);
  try {
    await page.screenshot({
      path: file,
      timeout: 3000,
      animations: "disabled",
    });
  } catch {
    const session = await page.context().newCDPSession(page);
    let timer;
    try {
      const r = await Promise.race([
        session.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("CDP screenshot timeout")),
            3000,
          );
        }),
      ]);
      fs.writeFileSync(file, Buffer.from(r.data, "base64"), { mode: 0o600 });
    } finally {
      clearTimeout(timer);
      await Promise.race([
        session.detach().catch(() => {}),
        new Promise((r) => setTimeout(r, 1000)),
      ]);
    }
  }
  return { file };
}
