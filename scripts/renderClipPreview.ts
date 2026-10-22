/**
 * Local preview render of a real prod clip candidate — same code path the
 * renderClip Lambda uses (buildRenderPlan + runFfmpeg), no AWS/DB. Mirrors
 * scripts/renderClipSmoke.ts but takes real kit values from argv so the
 * preview matches what the pipeline would render once moderated+approved.
 *
 * Usage: npx ts-node scripts/renderClipPreview.ts <source.mp4> <city> <state> <reportedAtISO>
 */
import * as fs from "fs/promises";
import * as path from "path";

import { buildRenderPlan } from "../src/lib/clipTemplate";
import { runFfmpeg } from "../src/lib/ffmpeg-exec";
import { detectVideoDuration } from "../src/lib/mp4-rotation";

async function main(): Promise<void> {
  const [inputArg, city, state, reportedAt] = process.argv.slice(2);
  if (!inputArg || !city || !state || !reportedAt) {
    console.error(
      "Usage: npx ts-node scripts/renderClipPreview.ts <source.mp4> <city> <state> <reportedAtISO>",
    );
    process.exit(1);
  }

  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  const inputPath = path.resolve(inputArg);
  const sourceBytes = await fs.readFile(inputPath);
  const duration = detectVideoDuration(sourceBytes);
  if (duration == null) {
    console.error("Could not parse duration from the MP4 (mvhd box).");
    process.exit(1);
  }

  const outputDir = await fs.mkdtemp(path.join("/tmp", "clip-preview-"));
  const plan = buildRenderPlan({
    city,
    state,
    reportedAt,
    sourceDuration: duration,
    inputPath,
    outputDir,
    assetPrefix: "clips/preview",
    fontFile: process.env.RENDER_FONT_FILE || null,
  });

  await fs.writeFile(path.join(outputDir, "kit.json"), plan.kitJson, "utf8");
  for (const file of plan.textFiles) {
    await fs.writeFile(file.path, file.content, "utf8");
  }

  console.log(`Source: ${duration.toFixed(1)}s → rendering in ${outputDir}`);
  await runFfmpeg(bin, plan.posterExtractArgs);
  await runFfmpeg(bin, plan.clipRenderArgs);

  for (const artifact of ["clip.mp4", "poster.jpg", "kit.json"]) {
    const stat = await fs.stat(path.join(outputDir, artifact));
    console.log(`  ${artifact}  ${(stat.size / 1024).toFixed(0)} KB`);
  }
  console.log(`Done: open ${outputDir}/clip.mp4`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});