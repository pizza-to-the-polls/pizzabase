/**
 * Local smoke test for the Clip Factory render spec v1 (issue #244).
 *
 * Builds the same ffmpeg plan the renderClip lambda builds (via the pure
 * src/lib/clipTemplate.ts builder), writes the drawtext text files, and
 * executes against a LOCAL ffmpeg binary — no AWS, no DB. Use it to verify
 * the rendered pixels before publishing a new ffmpeg layer version.
 *
 * Usage:
 *   npx ts-node scripts/renderClipSmoke.ts sample.mp4 ["caption text"]
 *
 * Options via env:
 *   FFMPEG_PATH       path to an ffmpeg binary (default: `ffmpeg` on PATH)
 *   RENDER_FONT_FILE  optional TTF for drawtext (as the lambda sets it)
 *
 * Output lands in a fresh /tmp/clip-smoke-* directory: clip.mp4, clip.srt,
 * poster.jpg. Open clip.mp4 and check the 9:16 crop, the bottom-third
 * caption (≤2 lines), the city/state lower third, and the 2s branded
 * end-card on the tail.
 */
import * as fs from "fs/promises";
import * as path from "path";

import { buildRenderPlan } from "../src/lib/clipTemplate";
import { runFfmpeg } from "../src/lib/ffmpeg-exec";
import { detectVideoDuration } from "../src/lib/mp4-rotation";

async function main(): Promise<void> {
  const [inputArg, captionArg] = process.argv.slice(2);
  if (!inputArg) {
    console.error(
      "Usage: npx ts-node scripts/renderClipSmoke.ts <sample.mp4> [caption]",
    );
    process.exit(1);
  }

  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  const inputPath = path.resolve(inputArg);
  const sourceBytes = await fs.readFile(inputPath);
  const duration = detectVideoDuration(sourceBytes);
  if (duration == null) {
    console.error("Could not parse duration from the sample MP4 (mvhd box).");
    process.exit(1);
  }

  const outputDir = await fs.mkdtemp(path.join("/tmp", "clip-smoke-"));
  const plan = buildRenderPlan({
    captionText: captionArg ?? "The line is around the block!",
    city: "Portland",
    state: "OR",
    reportedAt: new Date().toISOString(),
    shortUrlSlug: null,
    hashtags: null,
    sourceDuration: duration,
    inputPath,
    outputDir,
    assetPrefix: "clips/smoke",
    fontFile: process.env.RENDER_FONT_FILE || null,
  });

  await fs.writeFile(plan.srtPath, plan.sidecarSrt, "utf8");
  for (const file of plan.textFiles) {
    await fs.writeFile(file.path, file.content, "utf8");
  }

  console.log(`Source: ${duration.toFixed(1)}s → rendering in ${outputDir}`);
  await runFfmpeg(bin, plan.posterExtractArgs);
  await runFfmpeg(bin, plan.clipRenderArgs);

  for (const artifact of ["clip.mp4", "poster.jpg", "clip.srt"]) {
    const stat = await fs.stat(path.join(outputDir, artifact));
    console.log(`  ${artifact}  ${(stat.size / 1024).toFixed(0)} KB`);
  }
  console.log(`Done: open ${outputDir}/clip.mp4`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
