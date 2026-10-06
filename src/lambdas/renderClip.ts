/**
 * Lambda: renderClip
 *
 * Clip Factory renderer (Broadcast Flywheel 2.0, CLIP-002). Triggered by
 * fire-and-forget async invoke from src/lib/clip-render.ts with payload
 * { clipId }. No event sources — invocation only.
 *
 * Pipeline:
 *   1. Load Clip (+ Upload). Skip unless status is queued (idempotency
 *      against double-invoke; requeue re-fires the render).
 *   2. Daily budget guardrail (RENDER_DAILY_BUDGET, default 50): when the
 *      day's render count is exhausted the clip stays queued with a log
 *      line so a later invocation/requeue picks it up.
 *   3. queued → rendering. All subsequent validation (kit, processed media,
 *      source download) throws into the shared catch so every failure is a
 *      valid rendering → rejected transition.
 *   4. Source media: a processed MP4 renders as video (defense-in-depth
 *      duration check: > 90s or undetectable → rejected); a processed
 *      still (webp/jpeg) renders as a fixed 3s center-zoom clip (photo
 *      mode — no duration, silent, no end-card).
 *   5. Render via ffmpeg Lambda layer (args from the pure clipTemplate
 *      module): 1080x1920 center-crop. Videos render clean with a 2s
 *      brand-only end-card (no captions, no overlays, no QR), H.264/AAC,
 *      ≤90s; photos render as 3s H.264 zoom clips.
 *   6. Upload the bundle to clips/{clipId}/ (clip.mp4, poster.jpg,
 *      kit.json) and set status=ready with outputPaths.
 *   7. Any failure after the rendering transition → rejected + reason
 *      (valid rendering→rejected transition).
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { MoreThan } from "typeorm";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { initializeDataSource } from "../data-source";
import { Clip } from "../entity/Clip";
import { detectVideoDuration } from "../lib/mp4-rotation";
import { runFfmpeg } from "../lib/ffmpeg-exec";
import {
  buildRenderPlan,
  MAX_SOURCE_DURATION_SECONDS,
  PHOTO_CLIP_SECONDS,
} from "../lib/clipTemplate";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });

const PROCESSED_BUCKET = process.env.UPLOAD_S3_BUCKET || "reports.polls.pizza";
const FFMPEG_BIN = process.env.FFMPEG_PATH || "/opt/bin/ffmpeg";
const DEFAULT_DAILY_BUDGET = 50;

/**
 * Deterministic scratch directory for a clip's render artifacts. Exported
 * for tests (which pre-seed fake ffmpeg outputs here).
 */
export function renderWorkDir(clipId: number): string {
  return path.join(os.tmpdir(), `clip-render-${clipId}`);
}

/**
 * Extract an S3 key from a stored media URL. Stored processed_file_path.mp4
 * values are either CDN URLs (https://media.polls.pizza/uploads/x.mp4),
 * legacy path-style S3 URLs
 * (https://s3.us-west-2.amazonaws.com/bucket/uploads/x.mp4), or raw
 * s3://bucket/key URIs.
 */
export function s3KeyFromStoredUrl(url: string, bucket: string): string | null {
  if (url.startsWith("s3://")) {
    const rest = url.slice("s3://".length);
    const slash = rest.indexOf("/");
    return slash >= 0 ? rest.slice(slash + 1) : null;
  }
  try {
    const parsed = new URL(url);
    let keyPath = decodeURIComponent(parsed.pathname).replace(/^\//, "");
    if (keyPath.startsWith(`${bucket}/`)) {
      keyPath = keyPath.slice(bucket.length + 1);
    }
    return keyPath || null;
  } catch {
    return null;
  }
}

function kitString(kit: Record<string, unknown>, key: string): string | null {
  const value = kit[key];
  return typeof value === "string" && value.trim() ? value : null;
}

async function rejectClip(clip: Clip, reason: string): Promise<void> {
  console.error(`[render-clip] Clip ${clip.id} rejected: ${reason}`);
  if (!Clip.canTransition(clip.status, "rejected")) {
    console.warn(
      `[render-clip] Clip ${clip.id} in ${clip.status} state cannot be rejected — leaving as-is`,
    );
    return;
  }
  clip.status = "rejected";
  clip.failureReason = reason.slice(0, 500);
  await clip.save();
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
  console.log(`[render-clip] Uploaded s3://${PROCESSED_BUCKET}/${key}`);
}

export async function handler(event: { clipId?: number }): Promise<void> {
  const clipId = Number(event?.clipId);
  if (!Number.isFinite(clipId) || clipId <= 0) {
    console.warn(`[render-clip] Invalid or missing clipId in event`);
    return;
  }

  await initializeDataSource();

  const clip = await Clip.findOne({
    where: { id: clipId },
    relations: ["upload"],
  });
  if (!clip) {
    console.warn(`[render-clip] No clip ${clipId} found`);
    return;
  }

  // Idempotency guard: only queued clips render. A redelivered invoke or a
  // race with the approve/reject endpoints must not re-render.
  if (clip.status !== "queued") {
    console.log(
      `[render-clip] Clip ${clipId} is ${clip.status}, not queued — skipping`,
    );
    return;
  }

  // Cost guardrail: stop before transitioning if the day's budget is spent.
  // The clip stays queued so a later requeue re-fires the render.
  const budget = parseInt(process.env.RENDER_DAILY_BUDGET || "", 10);
  const dailyBudget = Number.isFinite(budget) ? budget : DEFAULT_DAILY_BUDGET;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const renderedToday = await Clip.count({
    where: { status: "ready", updatedAt: MoreThan(startOfDay) },
  });
  if (renderedToday >= dailyBudget) {
    console.log(
      `[render-clip] Daily render budget exhausted ` +
        `(${renderedToday}/${dailyBudget} rendered today) — clip ${clipId} stays queued`,
    );
    return;
  }

  if (!Clip.canTransition(clip.status, "rendering")) {
    console.warn(
      `[render-clip] Clip ${clipId} cannot transition from ${clip.status} to rendering`,
    );
    return;
  }
  clip.status = "rendering";
  await clip.save();

  const kit = clip.kit as Record<string, unknown> | null;
  const processedPaths = clip.upload?.processedFilePath || {};
  const mp4Url = processedPaths.mp4;
  // Photos come out of the media processor as webp (+ jpeg fallback).
  const photoUrl = processedPaths.webp || processedPaths.jpeg;

  const workDir = renderWorkDir(clipId);
  try {
    // Validation failures happen after the rendering transition so the clip
    // ends in rejected (rendering → rejected is a valid transition; queued
    // clips can only move to rendering).
    if (!kit) {
      throw new Error("Clip has no render kit");
    }
    if (!mp4Url && !photoUrl) {
      throw new Error("Upload has no processed media to render from");
    }
    const sourceUrl = mp4Url || photoUrl!;
    const sourceKey = s3KeyFromStoredUrl(sourceUrl, PROCESSED_BUCKET);
    if (!sourceKey) {
      throw new Error(`Could not determine S3 key from ${sourceUrl}`);
    }

    const obj = await s3.send(
      new GetObjectCommand({ Bucket: PROCESSED_BUCKET, Key: sourceKey }),
    );
    if (!obj.Body) {
      throw new Error(`Empty source object for ${sourceKey}`);
    }
    const sourceBytes = Buffer.from(await obj.Body.transformToByteArray());

    // Photo mode: stills skip the duration check and render at the fixed
    // 3s zoom-clip duration (sourceDuration: null).
    let sourceDuration: number | null = null;
    if (mp4Url) {
      const duration = detectVideoDuration(sourceBytes);
      if (duration == null) {
        throw new Error(
          "Source video duration could not be determined — refusing to render",
        );
      }
      if (duration > MAX_SOURCE_DURATION_SECONDS) {
        throw new Error(
          `Source duration ${duration.toFixed(1)}s exceeds the ` +
            `${MAX_SOURCE_DURATION_SECONDS}s clip limit`,
        );
      }
      sourceDuration = duration;
      console.log(
        `[render-clip] Clip ${clipId}: source ${sourceKey} is ` +
          `${duration.toFixed(1)}s`,
      );
    } else {
      console.log(
        `[render-clip] Clip ${clipId}: rendering photo ${sourceKey} ` +
          `as a ${PHOTO_CLIP_SECONDS}s zoom clip`,
      );
    }

    await fs.mkdir(workDir, { recursive: true });
    const ext = path.extname(sourceKey) || ".mp4";
    const inputPath = path.join(workDir, `input${ext}`);
    await fs.writeFile(inputPath, sourceBytes);

    const plan = buildRenderPlan({
      city: kitString(kit, "city") ?? "",
      state: kitString(kit, "state") ?? "",
      reportedAt: kitString(kit, "reportedAt") ?? "",
      sourceDuration,
      inputPath,
      outputDir: workDir,
      assetPrefix: `clips/${clipId}`,
      fontFile: process.env.RENDER_FONT_FILE || null,
    });

    for (const file of plan.textFiles) {
      await fs.writeFile(file.path, file.content, "utf8");
    }

    await runFfmpeg(FFMPEG_BIN, plan.posterExtractArgs);
    await runFfmpeg(FFMPEG_BIN, plan.clipRenderArgs);

    const prefix = `clips/${clipId}`;
    const videoKey = `${prefix}/clip.mp4`;
    const posterKey = `${prefix}/poster.jpg`;
    const kitKey = `${prefix}/kit.json`;

    await putObject(
      videoKey,
      await fs.readFile(path.join(workDir, "clip.mp4")),
      "video/mp4",
    );
    await putObject(
      posterKey,
      await fs.readFile(path.join(workDir, "poster.jpg")),
      "image/jpeg",
    );
    await putObject(
      kitKey,
      Buffer.from(plan.kitJson, "utf8"),
      "application/json",
    );

    clip.outputPaths = {
      video: videoKey,
      poster: posterKey,
      kit: kitKey,
    };
    clip.status = "ready";
    await clip.save();
    console.log(
      `[render-clip] Clip ${clipId} ready: ${JSON.stringify(clip.outputPaths)}`,
    );
  } catch (err) {
    await rejectClip(clip, err instanceof Error ? err.message : String(err));
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup; /tmp is ephemeral anyway.
    });
  }
}
