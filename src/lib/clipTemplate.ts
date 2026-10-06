/**
 * Pure ffmpeg render template for the Clip Factory (render spec v1).
 *
 * buildRenderPlan() turns a clip's publish kit into the exact ffmpeg
 * invocations and asset files needed to package a moderated upload as a
 * vertical (1080x1920) social clip:
 *
 *   - clip.mp4   9:16 center-crop, H.264, ≤90s. Video sources render
 *                clean with a ~2s brand-only end-card at the tail; still
 *                photos render as a fixed 3s center-zoom clip (no end-card
 *                — a 2s card would swallow a 3s photo). No captions, no
 *                overlays, no QR, no short URL anywhere.
 *   - poster.jpg first frame of the 9:16 render
 *   - kit.json   render kit (asset keys + report context)
 *
 * The module is intentionally pure: no fs, no ffmpeg, no clocks. The render
 * lambda (src/lambdas/renderClip.ts) writes the generated text files to disk
 * and executes the argument arrays. Keeping the args pure makes the render
 * contract unit-testable without running ffmpeg (see clipTemplate.test.ts).
 *
 * drawtext uses textfile= instead of text= everywhere: text can contain
 * quotes/colons/commas that are painful to escape through the ffmpeg
 * filtergraph parser — files sidestep escaping entirely.
 */

export const TARGET_WIDTH = 1080;
export const TARGET_HEIGHT = 1920;
export const MAX_SOURCE_DURATION_SECONDS = 90;
export const END_CARD_SECONDS = 2;

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
  /** ISO timestamp from the report kit ("reported HH:MM" overlay). */
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
  /** Absolute path to a TTF for drawtext (Lambda layer font), or null. */
  fontFile: string | null;
}

export interface ClipRenderTextFile {
  path: string;
  content: string;
}

export interface ClipRenderPlan {
  /** ffmpeg args producing poster.jpg (first frame, 9:16 crop). */
  posterExtractArgs: string[];
  /** ffmpeg args producing clip.mp4 (the full render). */
  clipRenderArgs: string[];
  /** Text files the handler must write for drawtext textfile= refs. */
  textFiles: ClipRenderTextFile[];
  /** Serialized kit.json (already formatted). */
  kitJson: string;
  /** Duration the rendered clip will have (capped at MAX). */
  renderedDurationSeconds: number;
  /** When the end-card overlay starts (renderedDuration - 2, min 0). */
  endCardStartSeconds: number;
}

/**
 * Escape a filesystem path for use in an ffmpeg filter option. Applied to
 * every path interpolated into the filtergraph — outputDir is /tmp-based in
 * practice, but this keeps the builder correct for arbitrary locations.
 */
export function escapeFilterPath(p: string): string {
  return p
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,");
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
  const endCardStart = Math.max(0, renderedDuration - END_CARD_SECONDS);

  const posterPath = `${input.outputDir}/poster.jpg`;
  const clipPath = `${input.outputDir}/clip.mp4`;

  // ── Photo mode: fixed 3s center-zoom clip, silent, no end-card ──
  // (A 2s end-card would swallow a 3s photo; compilations brand once via
  // the video members and the channel post instead.)
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
      textFiles: [],
      kitJson,
      renderedDurationSeconds: renderedDuration,
      endCardStartSeconds: 0,
    };
  }

  const textFiles: ClipRenderTextFile[] = [];
  const addTextFile = (name: string, content: string): string => {
    const filePath = `${input.outputDir}/${name}`;
    textFiles.push({ path: filePath, content });
    return filePath;
  };

  const fontSpec = input.fontFile
    ? `fontfile=${escapeFilterPath(input.fontFile)}:`
    : "";

  // ── Base video chain: clean 9:16 crop, no overlays on the photos ──
  const baseChain = [
    `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${TARGET_WIDTH}:${TARGET_HEIGHT}`,
    "setsar=1",
  ];

  // ── Branded end-card (composited over the last 2s) ──
  // Brand + site text only: no QR, no short URL, no attribution (product
  // direction — the donate close lives in the kit message instead).
  const cardChain = ["format=yuv420p"];
  const brandPath = addTextFile("endcard-brand.txt", "Pizza to the Polls");
  cardChain.push(
    `drawtext=textfile=${escapeFilterPath(brandPath)}:${fontSpec}` +
      "fontcolor=white:fontsize=64:x=(w-text_w)/2:y=780",
  );
  const sitePath = addTextFile("endcard-site.txt", "polls.pizza");
  cardChain.push(
    `drawtext=textfile=${escapeFilterPath(sitePath)}:${fontSpec}` +
      "fontcolor=0xB3B3B3:fontsize=40:x=(w-text_w)/2:y=900",
  );
  const filterSegments: string[] = [
    `[0:v]${baseChain.join(",")}[base]`,
    `[1:v]${cardChain.join(",")}[card]`,
    `[base][card]overlay=0:0:enable='gte(t,${endCardStart})'[out]`,
  ];
  const filterComplex = filterSegments.join(";");

  const clipRenderArgs = [
    "-y",
    "-i",
    input.inputPath,
    "-f",
    "lavfi",
    "-i",
    `color=c=0x101418:size=${TARGET_WIDTH}x${TARGET_HEIGHT}`,
  ];
  clipRenderArgs.push(
    "-filter_complex",
    filterComplex,
    "-map",
    "[out]",
    "-map",
    "0:a?",
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
  );

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
    textFiles,
    kitJson,
    renderedDurationSeconds: renderedDuration,
    endCardStartSeconds: endCardStart,
  };
}
