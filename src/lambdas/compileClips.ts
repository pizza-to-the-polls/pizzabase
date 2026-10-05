/**
 * Lambda: compileClips
 *
 * Scheduled Clip Factory compilation (every 3 hours via serverless.yml
 * `schedule: rate(3 hours)`). Joins all rendered-but-not-yet-compiled
 * video clips into one reel and posts it to the kit Zapier hook.
 *
 * Flow:
 *   1. Gather new content: per-upload clips (compilations excluded via
 *      upload IS NOT NULL) with status in ready/approved/published and
 *      compiled_at NULL, oldest first. None found → log and exit (the
 *      "if there's new content" gate — empty runs never render or post).
 *   2. Download each member's rendered clip.mp4 from the processed bucket.
 *      A member missing its render output is skipped (logged), never
 *      fails the run; if nothing survives, exit like an empty run.
 *   3. Normalize each member to identical stream parameters (30fps,
 *      1080x1920, H.264, silent) so the concat demuxer can join them
 *      with -c copy — the per-clip template renders uniform geometry but
 *      preserves source fps, which is not guaranteed across uploads.
 *   4. Concat → clips/{compilationId}/clip.mp4 + poster.jpg, mark the
 *      members compiled_at, save the compilation Clip (upload NULL,
 *      kit.memberClipIds + kit.photoLinks = source-photo links).
 *   5. Fire-and-forget notifyClipKit — the ZAP_NEW_CLIP Zapier message
 *      with the reel and links to every photo used.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { In, IsNull, Not } from "typeorm";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { initializeDataSource } from "../data-source";
import { Clip } from "../entity/Clip";
import { TARGET_WIDTH, TARGET_HEIGHT } from "../lib/clipTemplate";
import { runFfmpeg } from "../lib/ffmpeg-exec";
import { notifyClipKit } from "../lib/clipKit";
import { uploadPermalink } from "../lib/upload-permalink";
import { notifyBugsnag } from "../lib/notifyBugsnag";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });

const PROCESSED_BUCKET = process.env.UPLOAD_S3_BUCKET || "reports.polls.pizza";
const FFMPEG_BIN = process.env.FFMPEG_PATH || "/opt/bin/ffmpeg";

/** Clip statuses eligible for folding into a compilation. */
export const COMPILABLE_STATUSES = ["ready", "approved", "published"];

/**
 * ffmpeg args re-encoding one member render into a uniform, silent
 * segment (same geometry/coder settings the per-clip template uses, plus
 * fps=30). Pure and exported for tests.
 */
export function normalizeArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-i",
    inputPath,
    "-vf",
    `fps=30,scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${TARGET_WIDTH}:${TARGET_HEIGHT},setsar=1,format=yuv420p`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "22",
    outputPath,
  ];
}

/** concat-demuxer list file contents. Pure and exported for tests. */
export function concatList(memberFiles: string[]): string {
  return memberFiles.map((f) => `file '${f}'`).join("\n") + "\n";
}

async function getObject(key: string): Promise<Buffer> {
  const obj = await s3.send(
    new GetObjectCommand({ Bucket: PROCESSED_BUCKET, Key: key }),
  );
  if (!obj.Body) throw new Error(`Empty object for ${key}`);
  return Buffer.from(await obj.Body.transformToByteArray());
}

async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: PROCESSED_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  console.log(`[compile-clips] Uploaded s3://${PROCESSED_BUCKET}/${key}`);
}

/**
 * One scheduled compilation run. Split out of the handler so tests can
 * drive it directly with mocked S3/ffmpeg.
 */
export async function runCompilation(): Promise<Clip | null> {
  const candidates = await Clip.find({
    where: {
      status: In(COMPILABLE_STATUSES),
      compiledAt: IsNull(),
      upload: Not(IsNull()),
    },
    relations: ["upload"],
    order: { createdAt: "ASC" },
  });

  if (candidates.length === 0) {
    console.log("[compile-clips] No new clips to compile — exiting");
    return null;
  }

  const workDir = path.join(os.tmpdir(), `clip-compile-${Date.now()}`);
  let compilation: Clip | null = null;
  try {
    await fs.mkdir(workDir, { recursive: true });

    // Download member renders; skip any clip without render output.
    const memberFiles: string[] = [];
    const members: Clip[] = [];
    for (const clip of candidates) {
      const videoKey = (clip.outputPaths || {}).video;
      if (!videoKey) {
        console.warn(
          `[compile-clips] Clip ${clip.id} has no video output — skipping`,
        );
        continue;
      }
      try {
        const bytes = await getObject(videoKey);
        const memberPath = path.join(workDir, `member-${clip.id}.mp4`);
        await fs.writeFile(memberPath, bytes);
        memberFiles.push(memberPath);
        members.push(clip);
      } catch (err) {
        console.warn(
          `[compile-clips] Failed to download clip ${clip.id} (${videoKey}) — skipping:`,
          err,
        );
      }
    }

    if (members.length === 0) {
      console.log("[compile-clips] No downloadable member renders — exiting");
      return null;
    }

    // Normalize every member to identical stream parameters.
    const normalizedFiles: string[] = [];
    for (const memberPath of memberFiles) {
      const normalizedPath = memberPath.replace(/\.mp4$/, ".norm.mp4");
      await runFfmpeg(FFMPEG_BIN, normalizeArgs(memberPath, normalizedPath));
      normalizedFiles.push(normalizedPath);
    }

    // Concat with -c copy (safe post-normalization) and pull a poster
    // frame from the joined reel.
    const listPath = path.join(workDir, "members.txt");
    await fs.writeFile(listPath, concatList(normalizedFiles), "utf8");
    const reelPath = path.join(workDir, "clip.mp4");
    await runFfmpeg(FFMPEG_BIN, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      reelPath,
    ]);
    const posterPath = path.join(workDir, "poster.jpg");
    await runFfmpeg(FFMPEG_BIN, [
      "-y",
      "-i",
      reelPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      posterPath,
    ]);

    // Persist the compilation clip first so its id names the S3 prefix.
    compilation = new Clip();
    compilation.upload = null;
    compilation.status = "ready";
    compilation.kit = {
      isCompilation: true,
      caption: "The latest supporter clips, all in one reel",
      memberClipIds: members.map((clip) => clip.id),
      photoLinks: members.map((clip) => uploadPermalink(clip.upload!)),
    };
    await compilation.save();

    const prefix = `clips/${compilation.id}`;
    compilation.outputPaths = {
      video: `${prefix}/clip.mp4`,
      poster: `${prefix}/poster.jpg`,
    };
    // Compilations skip the volunteer approval gate (the per-clip upload
    // moderation already vetted every member) — mark approved so the
    // publish-confirmation loop can close on it.
    compilation.status = "approved";
    compilation.approvedBy = "compile-clips";
    compilation.approvedAt = new Date();
    await compilation.save();

    await putObject(
      compilation.outputPaths.video,
      await fs.readFile(reelPath),
      "video/mp4",
    );
    await putObject(
      compilation.outputPaths.poster,
      await fs.readFile(posterPath),
      "image/jpeg",
    );

    // Mark members compiled so the next run picks up only fresh content.
    const now = new Date();
    for (const member of members) {
      member.compiledAt = now;
      await member.save();
    }

    console.log(
      `[compile-clips] Compilation ${compilation.id} ready: ` +
        `${members.length} clips, photos ${JSON.stringify(
          compilation.kit.photoLinks,
        )}`,
    );

    // Fire-and-forget kit distribution — same pattern as approve().
    notifyClipKit(compilation).catch((err) => {
      console.error("notifyClipKit crashed:", err);
      notifyBugsnag(err instanceof Error ? err : new Error(String(err)));
    });

    return compilation;
  } catch (err) {
    console.error("[compile-clips] Compilation run failed:", err);
    notifyBugsnag(err instanceof Error ? err : new Error(String(err)));
    // A failed run leaves members uncompiled (compiled_at untouched) so
    // the next scheduled run retries them.
    return null;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup; /tmp is ephemeral anyway.
    });
  }
}

export async function handler(event: unknown): Promise<void> {
  console.log(
    `[compile-clips] Scheduled run: ${JSON.stringify(event).slice(0, 200)}`,
  );
  await initializeDataSource();
  await runCompilation();
}
