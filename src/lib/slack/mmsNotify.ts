/**
 * Slack notification for processed MMS media (MMS-004).
 *
 * When an MMS-origin upload finishes the async media pipeline (image
 * re-encode in on-media-format or video transcode in
 * on-mediaconvert-complete) and becomes `ready`, post a heads-up to an
 * internal Slack channel.
 *
 * Safety properties:
 *   - No-op unless MMS_SLACK_WEBHOOK_URL is configured (env-optional, like
 *     the Zapier hooks in src/lib/zapier.ts).
 *   - Only MMS-origin uploads notify; web uploads keep using zapNewUpload.
 *   - Flagged/rejected uploads never post — a human reviews those in Retool.
 *   - Only processed (EXIF-scrubbed) CDN URLs are shared, never raw paths.
 *   - Slack failures are swallowed: a webhook outage must never break the
 *     media pipeline lambdas (logged only, no Bugsnag — non-critical).
 */

import { Upload } from "../../entity/Upload";
import { cdnUrlFromStoredUrl } from "../media-cdn";

// Only these processedFilePath keys are CDN-served processed outputs.
// `jobId` (mid-transcode bookkeeping) and anything unknown are excluded.
const PROCESSED_MEDIA_KEYS = new Set(["webp", "jpeg", "jpg", "mp4", "gif"]);

export async function notifySlackMmsUpload(upload: Upload): Promise<void> {
  const webhookUrl = process.env.MMS_SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  if (upload.source !== "mms") return;

  // Flagged/rejected media is reviewed by a human in Retool — never post it.
  if (
    upload.moderationStatus === "flagged" ||
    upload.moderationStatus === "rejected"
  ) {
    return;
  }

  try {
    // The report relation is not eager — lambda call sites load uploads
    // without it, so reload when reportURL isn't available. It may
    // legitimately be null (nullable relation, onDelete SET NULL).
    let report = upload.report ?? null;
    if (upload.id != null && report?.reportURL === undefined) {
      const loaded = await Upload.findOne({
        where: { id: upload.id },
        relations: ["report"],
      });
      report = loaded?.report ?? null;
    }
    const reportURL = report?.reportURL ?? null;

    const processed = (upload.processedFilePath || {}) as Record<
      string,
      string
    >;
    const mediaLinks = Object.entries(processed)
      .filter(([key]) => PROCESSED_MEDIA_KEYS.has(key))
      .map(([, stored]) => cdnUrlFromStoredUrl(stored))
      .filter((url): url is string => Boolean(url));

    const { city, state } =
      upload.location || ({} as { city?: string; state?: string });

    const lines = [
      `🍕 New MMS media from a pizza recipient — ${city ?? "unknown"}, ${state ?? "unknown"}`,
    ];
    if (reportURL) {
      lines.push(`Report: ${reportURL}`);
    }
    if (mediaLinks.length > 0) {
      lines.push(`Media: ${mediaLinks.join("\n")}`);
    }
    lines.push(`SightEngine: ${upload.sightengineScore ?? "not scored"}`);

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
  } catch (err) {
    // Swallowed deliberately: Slack being down must never break the media
    // pipeline, and this integration is too non-critical for Bugsnag noise.
    console.error("[mms-notify] Slack notification failed (swallowed):", err);
  }
}
