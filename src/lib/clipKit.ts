/**
 * Slack kit distribution for the Clip Factory (DIST-001, manual-first).
 *
 * When a clip is approved, volunteers need the posting kit where they
 * already work: a Slack message with the poster preview and links to
 * every render asset. Volunteers post natively
 * from their phones, then confirm per platform via POST /clips/:id/publish
 * (closing the loop on the clip's publishLog).
 *
 * Env: ZAP_NEW_CLIP (Zapier catch hook URL). A Zap on the other end routes
 * the kit payload to the #clip-kit channel. Unset/empty means
 * distribution is disabled — notifyClipKit is a no-op with a log line, so
 * local/dev and stages without the hook keep working.
 *
 * Distribution must never break clip approval: notifyClipKit wraps
 * everything, logs failures, and reports to Bugsnag instead of throwing.
 */

import { Clip } from "../entity/Clip";
import { cdnUrlForKey } from "./media-cdn";
import { notifyBugsnag } from "./notifyBugsnag";

/**
 * Fallback public URL for a processed asset when no CDN is configured.
 * Processed clip artifacts live in the reports bucket under clips/{id}/.
 */
const directS3Url = (key: string): string => {
  const bucket = process.env.UPLOAD_S3_BUCKET;
  return bucket
    ? `https://${bucket}.s3.amazonaws.com/${key}`
    : `https://s3.amazonaws.com/${key}`;
};

/** CDN URL for a processed asset key, falling back to path-style S3. */
const assetUrl = (key: string | undefined): string | null => {
  if (!key) return null;
  return cdnUrlForKey(key) || directS3Url(key);
};

type SlackBlock = Record<string, unknown>;

/** Links to the source photos used in this clip/compilation (kit.photoLinks). */
const photoLinks = (kit: Record<string, unknown>): string[] =>
  Array.isArray(kit.photoLinks) &&
  kit.photoLinks.every((v) => typeof v === "string")
    ? (kit.photoLinks as string[])
    : [];

/** Rich photo entries (url, address, pizzas, restaurant) from kit.photos. */
const photoEntries = (kit: Record<string, unknown>): unknown[] =>
  Array.isArray(kit.photos) ? kit.photos : [];

/**
 * Build the full data payload for the ZAP_NEW_CLIP hook. Sends everything
 * known about the clip — flattened kit fields, resolved asset URLs, source
 * photo links, member clip ids, and the ready-to-post Slack message under
 * `slack` — so the Zap can attach whatever it needs without a redeploy.
 * More data beats less: the Zap sorts out what gets attached.
 */
export function buildClipKitPayload(clip: Clip): Record<string, unknown> {
  const kit = (clip.kit || {}) as Record<string, unknown>;
  const outputPaths = (clip.outputPaths || {}) as Record<string, string>;

  const iso = (v: unknown): string | null =>
    v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;

  return {
    clipId: clip.id,
    status: clip.status,
    isCompilation: kit.isCompilation === true,
    // Kit fields, passed through raw (nulls, not fabrications).
    city: typeof kit.city === "string" ? kit.city : null,
    state: typeof kit.state === "string" ? kit.state : null,
    reportedAt: iso(kit.reportedAt),
    memberClipIds: Array.isArray(kit.memberClipIds) ? kit.memberClipIds : null,
    photoLinks: photoLinks(kit),
    // Rich per-photo entries: { url, address, city, state, pizzas, restaurant }.
    photos: photoEntries(kit),
    // Relations (upload is null for compilations).
    uploadId: clip.upload ? clip.upload.id : null,
    approvedBy: clip.approvedBy,
    approvedAt: iso(clip.approvedAt),
    createdAt: iso(clip.createdAt),
    updatedAt: iso(clip.updatedAt),
    // Resolved public URLs for every render artifact.
    videoUrl: assetUrl(outputPaths.video),
    posterUrl: assetUrl(outputPaths.poster),
    kitJsonUrl: assetUrl(outputPaths.kit),
    // Raw S3 keys as stored.
    outputPaths,
    // Ready-to-post Slack Block Kit message — attach as-is or rebuild.
    slack: buildClipKitSlackPayload(clip),
  };
}

/**
 * Build the Slack Block Kit payload announcing an approved clip.
 * Exported for testing and for ops tooling that wants to preview the
 * message without posting it.
 */
export function buildClipKitSlackPayload(clip: Clip): Record<string, unknown> {
  const kit = (clip.kit || {}) as Record<string, unknown>;
  const outputPaths = (clip.outputPaths || {}) as Record<string, string>;

  const city = typeof kit.city === "string" ? kit.city : "Unknown city";
  const state = typeof kit.state === "string" ? kit.state : "";
  const where = state ? `${city}, ${state}` : city;

  // Compilations get a count-based headline; single clips stay city-based.
  const memberClipIds = Array.isArray(kit.memberClipIds)
    ? (kit.memberClipIds as unknown[])
    : [];
  const isCompilation = kit.isCompilation === true;
  const title = isCompilation
    ? `🎬 New compilation — ${memberClipIds.length} clips`
    : `🎬 New clip ready — ${where}`;

  const videoUrl = assetUrl(outputPaths.video);
  const fallbackText = isCompilation
    ? `🎬 New compilation: ${memberClipIds.length} clips — ${videoUrl || `clip ${clip.id}`}`
    : `🎬 New clip ready: ${where} — ${videoUrl || `clip ${clip.id}`}`;

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: title } },
  ];

  const posterUrl = assetUrl(outputPaths.poster);
  if (posterUrl) {
    blocks.push({
      type: "image",
      image_url: posterUrl,
      alt_text: `Poster frame for ${where}`,
    });
  }

  const links: string[] = [];
  const kitUrl = assetUrl(outputPaths.kit);
  if (videoUrl) links.push(`<${videoUrl}|Video (MP4)>`);
  if (kitUrl) links.push(`<${kitUrl}|Kit JSON>`);
  if (links.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: links.join("  ·  ") },
    });
  }

  // Every source photo used — one line each with its story (address,
  // pizzas ordered, restaurant) when the kit carries rich entries.
  const entries = photoEntries(kit) as Array<Record<string, unknown>>;
  const photos = photoLinks(kit);
  if (entries.length) {
    const lines = entries.map((entry, index) => {
      const url = typeof entry.url === "string" ? entry.url : `clip ${clip.id}`;
      const where = [entry.city, entry.state]
        .filter((v) => typeof v === "string")
        .join(", ");
      const story: string[] = [];
      if (typeof entry.address === "string") {
        story.push(where ? `${entry.address}, ${where}` : entry.address);
      }
      const pizzas = typeof entry.pizzas === "number" ? entry.pizzas : null;
      const restaurant =
        typeof entry.restaurant === "string" ? entry.restaurant : null;
      if (pizzas != null && restaurant) {
        story.push(
          `${pizzas} pizza${pizzas === 1 ? "" : "s"} from ${restaurant}`,
        );
      } else if (pizzas != null) {
        story.push(`${pizzas} pizzas ordered`);
      } else if (restaurant) {
        story.push(restaurant);
      }
      return `• <${url}|Photo ${index + 1}>${
        story.length ? ` — ${story.join(" · ")}` : ""
      }`;
    });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Photos used:*\n${lines.join("\n")}`,
      },
    });
  } else if (photos.length) {
    const lines = photos.map((url, index) => `• <${url}|Photo ${index + 1}>`);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Photos used:*\n${lines.join("\n")}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `📱 Post natively on TikTok / Reels / Shorts, then confirm with \`POST /clips/${clip.id}/publish\` \`{ platform, note? }\` to close the loop.`,
      },
    ],
  });

  return { text: fallbackText, blocks };
}

/**
 * Fire-and-forget kit notification for an approved clip, posted through the
 * ZAP_NEW_CLIP Zapier hook to the #clip-kit channel. Never throws: unset
 * hook → no-op; transport/build failures are logged and reported to Bugsnag
 * so distribution can never break clip approval.
 */
export async function notifyClipKit(clip: Clip): Promise<void> {
  try {
    const hook = process.env.ZAP_NEW_CLIP;
    if (!hook) {
      console.log(
        `[clip-kit] ZAP_NEW_CLIP unset — skipping kit notification for clip ${clip.id}`,
      );
      return;
    }

    const payload = buildClipKitPayload(clip);
    const response = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Same { hook, ...payload } envelope as lib/zapier so the Zap can
      // route by hook type — with the full clip dataset flattened inside.
      body: JSON.stringify({ hook: "ZAP_NEW_CLIP", clip: payload }),
    });
    if (!response.ok) {
      throw new Error(
        `Zapier hook responded ${response.status} for clip ${clip.id}`,
      );
    }
  } catch (err) {
    console.error(
      `[clip-kit] kit notification failed for clip ${clip.id}:`,
      err,
    );
    notifyBugsnag(err instanceof Error ? err : new Error(String(err)));
  }
}
