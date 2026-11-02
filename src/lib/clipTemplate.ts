/**
 * Pure ffmpeg render template for the Clip Factory (render spec v3).
 *
 * buildRenderPlan() turns a clip's publish kit into the exact ffmpeg
 * invocations needed to package a moderated upload as a vertical
 * (1080x1920) social clip containing ONLY the user-submitted media:
 *
 *   - clip.mp4   9:16 center-crop, H.264, ≤90s. Video sources render
 *                clean — no end-card, no captions, no lower third, no
 *                QR, no branding of any kind burned in; still photos
 *                render as a fixed 3s center-zoom clip.
 *   - poster.jpg first frame of the 9:16 render
 *   - kit.json   render kit (asset keys + report context)
 *
 * The module is intentionally pure: no fs, no ffmpeg, no clocks. The render
 * lambda (src/lambdas/renderClip.ts) executes the argument arrays. Keeping
 * the args pure makes the render contract unit-testable without running
 * ffmpeg (see clipTemplate.test.ts).
 */

export const TARGET_WIDTH = 1080;
export const TARGET_HEIGHT = 1920;
export const MAX_SOURCE_DURATION_SECONDS = 90;

// Photo clips: a fixed 3-second center zoom per still (product sketch:
// "3s/photo, zoom/pan"). Supersampled to 2x target before zoompan so the
// zoom motion stays smooth.
export const PHOTO_CLIP_SECONDS = 3;
export const PHOTO_FPS = 30;
export const PHOTO_FRAMES = PHOTO_CLIP_SECONDS * PHOTO_FPS; // 90
export const PHOTO_ZOOM_MAX = 1.12;
const SUPERSAMPLE_WIDTH = TARGET_WIDTH * 2;
const SUPERSAMPLE_HEIGHT = TARGET_HEIGHT * 2;

export interface ClipRenderInput {
  city: string;
  state: string;
  /** ISO timestamp from the report kit. */
  reportedAt: string;
  /**
   * Source duration in seconds for video (already verified ≤ MAX by the
   * caller). Null means the input is a still photo → fixed 3s zoom clip.
   */
  sourceDuration: number | null;
  /** Absolute path to the downloaded source media (MP4 / WEBP / JPEG). */
  inputPath: string;
  /** Absolute directory for clip.mp4 / poster.jpg. */
  outputDir: string;
  /** S3 key prefix for kit.json asset references, e.g. "clips/42". */
  assetPrefix: string;
}

export interface ClipRenderPlan {
  /** ffmpeg args producing poster.jpg (first frame, 9:16 crop). */
  posterExtractArgs: string[];
  /** ffmpeg args producing clip.mp4 (the full render). */
  clipRenderArgs: string[];
  /** Serialized kit.json (already formatted). */
  kitJson: string;
  /** Duration the rendered clip will have (capped at MAX). */
  renderedDurationSeconds: number;
}

export interface KitJsonInput {
  city: string;
  state: string;
  reportedAt: string;
  assets: { video: string; poster: string };
}

/**
 * Serialize the render kit written as clips/{id}/kit.json: report context
 * plus asset keys for the rendered artifacts.
 */
export function buildKitJson(input: KitJsonInput): string {
  return JSON.stringify(
    {
      city: input.city,
      state: input.state,
      reportedAt: input.reportedAt,
      platforms: ["tiktok", "reels", "shorts"],
      assets: input.assets,
    },
    null,
    2,
  );
}

export function buildRenderPlan(input: ClipRenderInput): ClipRenderPlan {
  const isPhoto = input.sourceDuration == null;
  const renderedDuration = isPhoto
    ? PHOTO_CLIP_SECONDS
    : Math.min(input.sourceDuration as number, MAX_SOURCE_DURATION_SECONDS);

  const posterPath = `${input.outputDir}/poster.jpg`;
  const clipPath = `${input.outputDir}/clip.mp4`;

  // ── Photo mode: fixed 3s center-zoom clip, silent ──
  if (isPhoto) {
    const posterExtractArgs = [
      "-y",
      "-i",
      input.inputPath,
      "-vf",
      `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase,crop=${TARGET_WIDTH}:${TARGET_HEIGHT}`,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      posterPath,
    ];

    // Supersample 2x before zoompan so the zoom motion stays smooth, then
    // render the single still into PHOTO_FRAMES frames at PHOTO_FPS.
    const zoomRate = (PHOTO_ZOOM_MAX - 1) / PHOTO_FRAMES;
    const photoFilter = [
      `scale=${SUPERSAMPLE_WIDTH}:${SUPERSAMPLE_HEIGHT}:force_original_aspect_ratio=increase`,
      `crop=${SUPERSAMPLE_WIDTH}:${SUPERSAMPLE_HEIGHT}`,
      "setsar=1",
      `zoompan=z='min(1+${zoomRate.toFixed(6)}*on,${PHOTO_ZOOM_MAX})':` +
        `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
        `d=${PHOTO_FRAMES}:s=${TARGET_WIDTH}x${TARGET_HEIGHT}:fps=${PHOTO_FPS}`,
    ].join(",");

    const clipRenderArgs = [
      "-y",
      "-i",
      input.inputPath,
      "-vf",
      photoFilter,
      "-frames:v",
      String(PHOTO_FRAMES),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      clipPath,
    ];

    const kitJson = buildKitJson({
      city: input.city,
      state: input.state,
      reportedAt: input.reportedAt,
      assets: {
        video: `${input.assetPrefix}/clip.mp4`,
        poster: `${input.assetPrefix}/poster.jpg`,
      },
    });

    return {
      posterExtractArgs,
      clipRenderArgs,
      kitJson,
      renderedDurationSeconds: renderedDuration,
    };
  }

  // ── Video mode: clean 9:16 crop of the user's media, nothing else ──
  const baseChain = [
    `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${TARGET_WIDTH}:${TARGET_HEIGHT}`,
    "setsar=1",
  ];

  const clipRenderArgs = [
    "-y",
    "-i",
    input.inputPath,
    "-vf",
    baseChain.join(","),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-t",
    String(renderedDuration),
    clipPath,
  ];

  const posterExtractArgs = [
    "-y",
    "-i",
    input.inputPath,
    "-vf",
    `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase,crop=${TARGET_WIDTH}:${TARGET_HEIGHT}`,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    posterPath,
  ];

  const kitJson = buildKitJson({
    city: input.city,
    state: input.state,
    reportedAt: input.reportedAt,
    assets: {
      video: `${input.assetPrefix}/clip.mp4`,
      poster: `${input.assetPrefix}/poster.jpg`,
    },
  });

  return {
    posterExtractArgs,
    clipRenderArgs,
    kitJson,
    renderedDurationSeconds: renderedDuration,
  };
}
