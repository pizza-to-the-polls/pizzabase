/**
 * Pure ffmpeg render template for the Clip Factory (render spec v1).
 *
 * buildRenderPlan() turns a clip's publish kit into the exact ffmpeg
 * invocations and asset files needed to package a moderated upload as a
 * vertical (1080x1920) social clip:
 *
 *   - clip.mp4   9:16 center-crop, H.264/AAC, ≤90s, burned-in caption
 *                (bottom-third drawtext, stable max 2 lines), city/state
 *                lower third, and a ~2s branded end-card composited over
 *                the tail
 *   - clip.srt   sidecar captions for platforms that accept them
 *   - poster.jpg first frame of the 9:16 render
 *   - kit.json   publish kit (caption + hashtags + asset keys)
 *
 * The module is intentionally pure: no fs, no ffmpeg, no clocks. The render
 * lambda (src/lambdas/renderClip.ts) writes the generated text files to disk
 * and executes the argument arrays. Keeping the args pure makes the render
 * contract unit-testable without running ffmpeg (see clipTemplate.test.ts).
 *
 * drawtext uses textfile= instead of text= everywhere: user-provided caption
 * text can contain quotes/colons/commas that are painful to escape through
 * the ffmpeg filtergraph parser — files sidestep escaping entirely.
 */

import { deriveHashtags } from "./clip-hashtags";

export const TARGET_WIDTH = 1080;
export const TARGET_HEIGHT = 1920;
export const MAX_SOURCE_DURATION_SECONDS = 90;
export const END_CARD_SECONDS = 2;

// Burned-in caption layout: stable max 2 wrapped lines, bottom-third.
const CAPTION_LINE_CHARS = 36;
const CAPTION_MAX_LINES = 2;
const CAPTION_FONT_SIZE = 52;
const CAPTION_LINE1_Y = "h-300";
const CAPTION_LINE2_Y = "h-224";

export interface ClipRenderInput {
  /** Caption from clip.kit — null means no burned-in captions. */
  captionText: string | null;
  city: string;
  state: string;
  /** ISO timestamp from the report kit ("reported HH:MM" overlay). */
  reportedAt: string;
  /** Short-link slug — null in v1 (wired up by a later issue). */
  shortUrlSlug: string | null;
  /** Starter hashtags from clip.kit; falls back to derived set. */
  hashtags: string[] | null;
  /** Source duration in seconds (already verified ≤ MAX by the caller). */
  sourceDuration: number;
  /** Absolute path to the downloaded source MP4. */
  inputPath: string;
  /** Absolute directory for clip.mp4 / clip.srt / poster.jpg. */
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
  /** Sidecar SRT content (also the burned-in caption source of truth). */
  sidecarSrt: string;
  /** Where the handler must write sidecarSrt before rendering. */
  srtPath: string;
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

/**
 * Format the kit's reportedAt as a compact 12-hour time for the lower third
 * ("2:30 PM"). Rendered in UTC so every renderer produces the same string.
 * Returns null for missing/invalid input (overlay line is skipped).
 */
export function formatReportedTime(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(date);
}

/**
 * Wrap caption text into at most 2 lines of CAPTION_LINE_CHARS each, for a
 * stable burned-in layout. Overlong words are hard-truncated; overflowing
 * text is elided with an ellipsis on the final line.
 */
export function wrapCaption(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= CAPTION_LINE_CHARS) {
      current = candidate;
      continue;
    }
    if (current) {
      if (lines.length === CAPTION_MAX_LINES - 1) break;
      lines.push(current);
      current = "";
    }
    current =
      word.length > CAPTION_LINE_CHARS
        ? `${word.slice(0, CAPTION_LINE_CHARS - 1)}…`
        : word;
  }
  if (current && lines.length < CAPTION_MAX_LINES) lines.push(current);

  if (i < words.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, CAPTION_LINE_CHARS - 1)}…`;
  }
  return lines.join("\n");
}

function srtTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(clamped / 3600))}:${pad(
    Math.floor((clamped % 3600) / 60),
  )}:${pad(clamped % 60)},000`;
}

/**
 * Build the sidecar SRT: a single caption entry spanning the main body
 * (up to the end-card). Empty string when there is no caption text.
 */
export function buildSrt(
  captionText: string | null,
  endSeconds: number,
): string {
  if (!captionText || !captionText.trim()) return "";
  const body = wrapCaption(captionText);
  if (!body) return "";
  return `1\n${srtTimestamp(0)} --> ${srtTimestamp(
    Math.max(1, Math.floor(endSeconds)),
  )}\n${body}\n`;
}

export interface KitJsonInput {
  captionText: string | null;
  hashtags: string[] | null;
  shortUrlSlug: string | null;
  city: string;
  state: string;
  reportedAt: string;
  assets: { video: string; captions: string; poster: string };
}

/**
 * Serialize the publish kit written as clips/{id}/kit.json. The caption
 * gets the PTP signature suffix; missing hashtags fall back to the
 * deterministic derived set; shortUrlSlug stays null in v1.
 */
export function buildKitJson(input: KitJsonInput): string {
  const trimmed = input.captionText ? input.captionText.trim() : "";
  return JSON.stringify(
    {
      caption: trimmed ? `${trimmed} 🍕🗳` : null,
      hashtags:
        input.hashtags && input.hashtags.length > 0
          ? input.hashtags
          : deriveHashtags(input.city, input.state),
      shortUrlSlug: input.shortUrlSlug ?? null,
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
  const renderedDuration = Math.min(
    input.sourceDuration,
    MAX_SOURCE_DURATION_SECONDS,
  );
  const endCardStart = Math.max(0, renderedDuration - END_CARD_SECONDS);

  const srtPath = `${input.outputDir}/clip.srt`;
  const posterPath = `${input.outputDir}/poster.jpg`;
  const clipPath = `${input.outputDir}/clip.mp4`;

  const sidecarSrt = buildSrt(input.captionText, endCardStart);
  const captionLines =
    input.captionText && input.captionText.trim()
      ? wrapCaption(input.captionText).split("\n").slice(0, CAPTION_MAX_LINES)
      : [];

  const textFiles: ClipRenderTextFile[] = [];
  const addTextFile = (name: string, content: string): string => {
    const filePath = `${input.outputDir}/${name}`;
    textFiles.push({ path: filePath, content });
    return filePath;
  };

  const fontSpec = input.fontFile
    ? `fontfile=${escapeFilterPath(input.fontFile)}:`
    : "";

  // ── Caption + lower third drawtext filters on the main video ──
  const baseChain = [
    `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${TARGET_WIDTH}:${TARGET_HEIGHT}`,
    "setsar=1",
  ];

  captionLines.forEach((line, index) => {
    const filePath = addTextFile(`caption-line-${index + 1}.txt`, line);
    const y = index === 0 ? CAPTION_LINE1_Y : CAPTION_LINE2_Y;
    baseChain.push(
      `drawtext=textfile=${escapeFilterPath(filePath)}:${fontSpec}` +
        `fontcolor=white:fontsize=${CAPTION_FONT_SIZE}:borderw=3:` +
        `bordercolor=black:x=(w-text_w)/2:y=${y}`,
    );
  });

  const lowerThirdPath = addTextFile(
    "lowerthird-city.txt",
    `${input.city}, ${input.state}`.trim().replace(/^,\s*/, ""),
  );
  baseChain.push(
    `drawtext=textfile=${escapeFilterPath(lowerThirdPath)}:${fontSpec}` +
      "fontcolor=white:fontsize=44:box=1:boxcolor=black@0.55:" +
      "boxborderw=14:x=64:y=h-440",
  );

  const reportedTime = formatReportedTime(input.reportedAt);
  if (reportedTime) {
    const reportedPath = addTextFile(
      "lowerthird-reported.txt",
      `reported ${reportedTime}`,
    );
    baseChain.push(
      `drawtext=textfile=${escapeFilterPath(reportedPath)}:${fontSpec}` +
        "fontcolor=white:fontsize=30:box=1:boxcolor=black@0.55:" +
        "boxborderw=10:x=64:y=h-372",
    );
  }

  // ── Branded end-card (composited over the last 2s) ──
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
  if (input.shortUrlSlug) {
    const urlPath = addTextFile(
      "endcard-url.txt",
      `polls.pizza/${input.shortUrlSlug}`,
    );
    cardChain.push(
      `drawtext=textfile=${escapeFilterPath(urlPath)}:${fontSpec}` +
        "fontcolor=white:fontsize=36:x=(w-text_w)/2:y=990",
    );
  }

  const filterComplex = [
    `[0:v]${baseChain.join(",")}[base]`,
    `[1:v]${cardChain.join(",")}[card]`,
    `[base][card]overlay=0:0:enable='gte(t,${endCardStart})'[out]`,
  ].join(";");

  const clipRenderArgs = [
    "-y",
    "-i",
    input.inputPath,
    "-f",
    "lavfi",
    "-i",
    `color=c=0x101418:size=${TARGET_WIDTH}x${TARGET_HEIGHT}`,
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
    captionText: input.captionText,
    hashtags: input.hashtags,
    shortUrlSlug: input.shortUrlSlug,
    city: input.city,
    state: input.state,
    reportedAt: input.reportedAt,
    assets: {
      video: `${input.assetPrefix}/clip.mp4`,
      captions: `${input.assetPrefix}/clip.srt`,
      poster: `${input.assetPrefix}/poster.jpg`,
    },
  });

  return {
    posterExtractArgs,
    clipRenderArgs,
    sidecarSrt,
    srtPath,
    textFiles,
    kitJson,
    renderedDurationSeconds: renderedDuration,
    endCardStartSeconds: endCardStart,
  };
}
