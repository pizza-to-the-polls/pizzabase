import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { verifyTwilioSignature } from "../lib/twilio/verifySignature";
import { notifyBugsnag } from "../lib/notifyBugsnag";
import { BannedPhoneNumber } from "../entity/BannedPhoneNumber";
import { Report } from "../entity/Report";
import { Upload } from "../entity/Upload";
import { normalizePhone } from "../lib/validator/normalizeContact";

/**
 * MMS-003: inbound Twilio SMS/MMS webhook.
 *
 * Flow:
 *   1. Verify the X-Twilio-Signature header (403 + minimal TwiML on
 *      failure), or the shared-token trusted-relay path (X-PTP-Inbound-Token
 *      / Authorization: Bearer) used by the Zapier catch-hook Zap that
 *      forwards non-Twilio multimedia messages in the same Twilio shape.
 *   2. Handle bans / STOP opt-out keywords.
 *   3. Match the sender to a recent fulfilled report (MMS-001).
 *   4. Download attached media (short-lived signed Twilio S3 redirects) and
 *      PutObject the raw bytes into the raw uploads bucket — the existing
 *      EXIF → format → transcode pipeline (onMediaFormat) runs from the S3
 *      trigger automatically. presignUpload / zapNewUpload are deliberately
 *      NOT used: this path is server-to-S3, not client uploads.
 *   5. Reply with TwiML (Content-Type: text/xml) for every path.
 */

const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_MEDIA_ITEMS = 10; // Twilio allows MediaUrl0..MediaUrl9
const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL"]);

// Aligned with IMAGE_EXTENSIONS / VIDEO_EXTENSIONS in onMediaFormat.ts so
// anything we store is something the pipeline can process.
/**
 * Twilio media host allowlist — SSRF guard for the fetch below
 * (defense-in-depth for the js/request-forgery surface). Signature
 * verification is the primary trust boundary; this bounds the blast
 * radius if that ever fails or is bypassed: a URL that isn't a Twilio
 * media host is never fetched, whatever the (verified) body claims.
 */
// Extra hosts allowed for MediaUrl fetches — staging-only test media
// (e.g. public sample videos). Prod leaves this unset: the default policy
// is Twilio-only, and this env var is deliberately never set in prod deploys.
const twilioMediaExtraHosts = (): Set<string> => {
  const hosts = (process.env.TWILIO_MEDIA_EXTRA_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set(hosts);
};

/**
 * Media URL guard for the trusted-relay path (see inbound): the sender is
 * authenticated by shared token, so any https host is acceptable. Runs in
 * Lambda (no instance metadata to leak), the 5MB cap applies, and no
 * credentials are forwarded to the fetch target.
 */
const isHttpsMediaUrl = (url: string): boolean => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Authenticate the trusted-relay sender (e.g. the Zapier catch-hook Zap that
 * forwards non-Twilio multimedia messages to this endpoint in the same
 * shape Twilio POSTs). The shared token rides in X-PTP-Inbound-Token or as
 * `Authorization: Bearer <token>` — both are static headers Zapier can send.
 */
const relayTokenFrom = (request: Request): string => {
  const custom = request.headers["x-ptp-inbound-token"];
  if (typeof custom === "string" && custom.length > 0) return custom;
  const authorization = request.headers.authorization;
  if (typeof authorization === "string") {
    const [scheme, token] = authorization.split(" ");
    if (scheme.toLowerCase() === "bearer" && token) return token;
  }
  return "";
};

const isRelayAuthorized = (request: Request): boolean => {
  const expected = process.env.INBOUND_WEBHOOK_TOKEN || "";
  if (!expected) return false;
  return relayTokenFrom(request) === expected;
};

const isTwilioMediaUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "api.twilio.com" ||
      host.endsWith(".twilio.com") ||
      host.endsWith(".twiliocdn.com") ||
      twilioMediaExtraHosts().has(host)
    );
  } catch {
    return false;
  }
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

const OPTED_OUT_REPLY =
  "You're opted out of messages from Pizza Polls. Reply START to receive messages again.";
const UNSUBSCRIBED_REPLY =
  "You've been unsubscribed from Pizza Polls messages. Reply START to opt back in.";
const THANKS_REPLY = "Thanks for your message! 🍕";
const NO_MATCH_MEDIA_REPLY =
  "Thanks! We couldn't match this to a recent pizza delivery — if this is about a report, reply within 30 days of delivery.";
const SHARED_REPLY = "Thanks for sharing! 🍕";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Minimal TwiML builder — no external Twilio SDK needed for replies. */
function twiml(message?: string): string {
  return message
    ? `${XML_DECL}<Response><Message>${escapeXml(message)}</Message></Response>`
    : `${XML_DECL}<Response/>`;
}

function sendTwiml(response: Response, status: number, message?: string) {
  response.status(status);
  response.set("Content-Type", "text/xml");
  response.send(twiml(message));
}

interface MediaItem {
  url: string;
  contentType: string;
}

/** Collect MediaUrl{N} / MediaContentType{N} pairs from the parsed form body. */
function collectMediaItems(body: Record<string, any> | undefined): MediaItem[] {
  const items: MediaItem[] = [];
  const form = body ?? {};
  for (let i = 0; i < MAX_MEDIA_ITEMS; i++) {
    const url = form[`MediaUrl${i}`];
    if (!url) continue;
    items.push({
      url: String(url),
      contentType: String(form[`MediaContentType${i}`] ?? ""),
    });
  }
  return items;
}

export class TwilioInboundController {
  async inbound(request: Request, response: Response, _next: NextFunction) {
    // Twilio signs the exact URL it POSTed to, including query string.
    const url = `${request.protocol}://${request.get("host")}${request.originalUrl}`;

    // Two trust paths reach this handler:
    //   1. Real Twilio: valid X-Twilio-Signature (HMAC over url + params).
    //   2. Trusted relay (the Zapier catch-hook Zap forwarding non-Twilio
    //      multimedia messages): shared-token auth via X-PTP-Inbound-Token
    //      or Authorization: Bearer. Relay sends may be JSON — the shape is
    //      the same flat Twilio keys (From, Body, MediaUrl0, ...).
    // Media fetching is stricter for (1): Twilio hosts only. Relay (2) may
    // reference any https host, since the sender holds the token.
    const signatureOk = verifyTwilioSignature({
      url,
      body: request.body ?? {},
      signature: (request.headers["x-twilio-signature"] as string) ?? null,
    });
    const relayOk = isRelayAuthorized(request);

    if (!signatureOk && !relayOk) {
      notifyBugsnag(
        new Error(
          `Twilio inbound webhook: signature verification failed for ${url}`,
        ),
      );
      sendTwiml(response, 403);
      return null;
    }

    const isAllowedMediaUrl = signatureOk ? isTwilioMediaUrl : isHttpsMediaUrl;

    const from = String(request.body?.From ?? "");
    const text = String(request.body?.Body ?? "");
    const mediaItems = collectMediaItems(request.body);
    const normalizedPhone = normalizePhone(from);

    try {
      // --- Bans / opt-out -------------------------------------------------
      if (await BannedPhoneNumber.isBanned(normalizedPhone)) {
        sendTwiml(response, 200, OPTED_OUT_REPLY);
        return null;
      }

      if (STOP_KEYWORDS.has(text.trim().toUpperCase())) {
        try {
          const ban = new BannedPhoneNumber();
          ban.phoneNumber = normalizedPhone;
          ban.reason = "STOP via MMS inbound webhook";
          ban.bannedBy = "twilio-webhook";
          await ban.save();
        } catch (e) {
          // Duplicate STOP / DB hiccup must not break the opt-out reply.
          notifyBugsnag(e as Error);
        }
        sendTwiml(response, 200, UNSUBSCRIBED_REPLY);
        return null;
      }

      // --- Report matching -------------------------------------------------
      const report = await Report.findRecentFulfilledByPhone(from);

      if (!report) {
        // Never store orphan media — nothing here is attached to a report.
        sendTwiml(
          response,
          200,
          mediaItems.length > 0 ? NO_MATCH_MEDIA_REPLY : THANKS_REPLY,
        );
        return null;
      }

      // --- Media ingestion --------------------------------------------------
      const s3Client = new S3Client({
        region: process.env.AWS_REGION || "us-west-2",
      });

      let savedCount = 0;
      let oversizeCount = 0;
      let unsupportedCount = 0;
      let failedCount = 0;

      for (const item of mediaItems) {
        try {
          const fileExt = MIME_TO_EXT[item.contentType];
          if (!fileExt) {
            unsupportedCount++;
            continue;
          }

          // SSRF guard: only ever fetch media from Twilio's own hosts.
          if (!isAllowedMediaUrl(item.url)) {
            unsupportedCount++;
            continue;
          }

          // Twilio media URLs are short-lived signed S3 redirects — download
          // immediately, never defer.
          const mediaResponse = await fetch(item.url);
          if (!mediaResponse.ok) {
            throw new Error(
              `Twilio media download failed with HTTP ${mediaResponse.status}`,
            );
          }
          const declaredLength = Number(
            mediaResponse.headers.get("content-length"),
          );
          if (
            Number.isFinite(declaredLength) &&
            declaredLength > MAX_MEDIA_BYTES
          ) {
            oversizeCount++;
            continue;
          }
          const bytes = Buffer.from(await mediaResponse.arrayBuffer());
          if (bytes.length > MAX_MEDIA_BYTES) {
            oversizeCount++;
            continue;
          }

          const fileHash = crypto
            .createHash("sha256")
            .update(bytes)
            .digest("hex");

          const [upload, isDuplicate] = await Upload.createFromMms(report, {
            fileExt,
            fileHash,
            sourcePhone: normalizedPhone,
          });

          if (!isDuplicate) {
            // The S3 put is the pipeline trigger — do NOT presign or zap.
            await s3Client.send(
              new PutObjectCommand({
                Bucket:
                  upload.rawBucket ||
                  process.env.RAW_UPLOADS_BUCKET ||
                  "raw.polls.pizza",
                Key: upload.filePath,
                Body: bytes,
              }),
            );
          }
          savedCount++;
        } catch (e) {
          // One failed media item must not abort the others.
          failedCount++;
          notifyBugsnag(e as Error);
        }
      }

      // --- Reply -------------------------------------------------------------
      let message: string;
      if (savedCount > 0) {
        message = SHARED_REPLY;
      } else if (failedCount > 0) {
        message =
          "Thanks for your message! We had trouble saving the files you sent.";
      } else {
        message = THANKS_REPLY;
      }
      if (oversizeCount > 0) {
        message += " We couldn't save files over 5MB.";
      }
      if (unsupportedCount > 0) {
        message += " We couldn't process some of the files you sent.";
      }

      sendTwiml(response, 200, message);
      return null;
    } catch (e) {
      // Robustness: never leak stack traces into TwiML, always reply XML.
      notifyBugsnag(e as Error);
      if (!response.headersSent) {
        sendTwiml(
          response,
          200,
          "Sorry — something went wrong on our end. Please try again later.",
        );
      }
      return null;
    }
  }
}
