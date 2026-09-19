/**
 * Slack kit distribution for the Clip Factory (DIST-001, manual-first).
 *
 * When a clip is approved, volunteers need the posting kit where they
 * already work: a Slack message with the poster preview, caption +
 * hashtags, and links to every render asset. Volunteers post natively
 * from their phones, then confirm per platform via POST /clips/:id/publish
 * (closing the loop on the clip's publishLog).
 *
 * Env: CLIP_KIT_SLACK_WEBHOOK (Slack incoming webhook URL). Unset/empty
 * means distribution is disabled — notifyClipKit is a no-op with a log
 * line, so local/dev and stages without a webhook keep working.
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

/** Donation short link for the clip (matches the /l/:slug route). */
const shortLinkUrl = (clip: Clip): string | null => {
  const slug = (clip.kit as Record<string, unknown> | null)?.shortUrlSlug;
  if (typeof slug !== "string" || !slug) return null;
  const base = process.env.SHORT_URL_BASE || "https://polls.pizza/l";
  return `${base}/${slug}`;
};

type SlackBlock = Record<string, unknown>;

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
  const title = `🎬 New clip ready — ${where}`;

  const shortUrl = shortLinkUrl(clip);
  const videoUrl = assetUrl(outputPaths.video);
  const linkOrClip = shortUrl || videoUrl || `clip ${clip.id}`;
  const fallbackText = `🎬 New clip ready: ${where} — ${linkOrClip}`;

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

  const caption = typeof kit.caption === "string" ? kit.caption : "";
  const hashtags = Array.isArray(kit.hashtags) ? kit.hashtags.join(" ") : "";
  const captionText = [caption || "_No caption in kit_", hashtags]
    .filter(Boolean)
    .join("\n");
  blocks.push({ type: "section", text: { type: "mrkdwn", text: captionText } });

  const links: string[] = [];
  const captionsUrl = assetUrl(outputPaths.captions);
  const kitUrl = assetUrl(outputPaths.kit);
  if (videoUrl) links.push(`<${videoUrl}|Video (MP4)>`);
  if (captionsUrl) links.push(`<${captionsUrl}|Captions (SRT)>`);
  if (kitUrl) links.push(`<${kitUrl}|Kit JSON>`);
  if (shortUrl) links.push(`<${shortUrl}|Donation link>`);
  if (links.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: links.join("  ·  ") },
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
 * Fire-and-forget Slack notification for an approved clip. Never throws:
 * unset webhook → no-op; transport/build failures are logged and reported
 * to Bugsnag so distribution can never break clip approval.
 */
export async function notifyClipKit(clip: Clip): Promise<void> {
  try {
    const webhook = process.env.CLIP_KIT_SLACK_WEBHOOK;
    if (!webhook) {
      console.log(
        `[clip-kit] CLIP_KIT_SLACK_WEBHOOK unset — skipping Slack notification for clip ${clip.id}`,
      );
      return;
    }

    const payload = buildClipKitSlackPayload(clip);
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(
        `Slack webhook responded ${response.status} for clip ${clip.id}`,
      );
    }
  } catch (err) {
    console.error(
      `[clip-kit] Slack notification failed for clip ${clip.id}:`,
      err,
    );
    notifyBugsnag(err instanceof Error ? err : new Error(String(err)));
  }
}
