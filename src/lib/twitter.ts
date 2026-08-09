import crypto from "crypto";
import FormData from "form-data";
import { Order, OrderTypes } from "../entity/Order";
import { Upload } from "../entity/Upload";
import { notifyBugsnag } from "./notifyBugsnag";

const TWITTER_API_BASE = "https://api.twitter.com";
const TWITTER_UPLOAD_BASE = "https://upload.twitter.com";
const MAX_TWEET_LENGTH = 280;
const URL_CHAR_COUNT = 23;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MediaItem {
  url: string;
  altText: string;
  isVideo: boolean;
}

interface TwitterError {
  code?: number;
  message?: string;
}

interface TwitterErrorResponse {
  errors?: TwitterError[];
}

interface TwitterMediaUploadResponse {
  media_id_string: string;
  media_id?: number;
  processing_info?: {
    state: string;
    check_after_secs?: number;
    error?: { message: string };
  };
}

// ---------------------------------------------------------------------------
// OAuth 1.0a
// ---------------------------------------------------------------------------

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

/**
 * Generate an OAuth 1.0a Authorization header value.
 *
 * @param method   HTTP method (GET, POST, etc.)
 * @param baseUrl  The endpoint URL without query string
 * @param params   Additional request parameters to include in the signature
 *                 (e.g. form-urlencoded body params for media commands)
 */
function generateOAuthHeader(
  method: string,
  baseUrl: string,
  params: Record<string, string> = {}
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: process.env.TWITTER_API_KEY!,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: process.env.TWITTER_ACCESS_TOKEN!,
    oauth_version: "1.0",
  };

  // Combine and sort all params for the signature base string
  const allParams = { ...params, ...oauthParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  // Signature base string: METHOD & urlencode(base URL) & urlencode(params)
  const signatureBase = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join("&");

  // Signing key: consumer_secret & token_secret
  const signingKey = `${percentEncode(
    process.env.TWITTER_API_SECRET!
  )}&${percentEncode(process.env.TWITTER_ACCESS_SECRET!)}`;

  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");

  // Build the Authorization header value
  const headerParams = { ...oauthParams, oauth_signature: signature };
  return (
    "OAuth " +
    Object.entries(headerParams)
      .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
      .join(", ")
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build tweet text from an order, respecting Twitter's 280-character limit
 * and URL counting rules (URLs count as 23 characters regardless of actual
 * length due to t.co wrapping).
 *
 * The returned text may exceed 280 literal characters when the location URL
 * is long, since Twitter counts the URL as only 23 chars. The effective
 * tweet length (body + 1 space + 23 for URL) is always ≤ 280.
 */
function buildTweetText(order: Order): string {
  const { quantity, orderType, restaurant, location } = order;
  const locationUrl = `${
    process.env.STATIC_SITE || "https://polls.pizza"
  }/location/${encodeURIComponent(location.fullAddress)}`;

  const typeLabel =
    orderType === OrderTypes.donuts
      ? "dozen donuts"
      : orderType === OrderTypes.pizzas
      ? "pizzas"
      : orderType;

  // Build body text without URL
  let body = `${quantity} ${typeLabel} ordered for ${location.address}, ${location.city}! 🍕`;

  if (restaurant) {
    body += ` (from ${restaurant})`;
  }

  // Effective tweet length = body + 1 space + 23 (URL always counts as 23).
  // Twitter's /2/tweets endpoint applies t.co wrapping automatically.
  const effectiveLength = body.length + 1 + URL_CHAR_COUNT;

  if (effectiveLength > MAX_TWEET_LENGTH) {
    // Try dropping restaurant info first
    if (restaurant) {
      const withoutRestaurant = `${quantity} ${typeLabel} ordered for ${location.address}, ${location.city}! 🍕`;
      if (withoutRestaurant.length + 1 + URL_CHAR_COUNT <= MAX_TWEET_LENGTH) {
        return `${withoutRestaurant} ${locationUrl}`;
      }
    }

    // Truncate body to fit: reserve 1 for space, URL_CHAR_COUNT for URL, 3 for ellipsis
    const maxBodyLen = MAX_TWEET_LENGTH - URL_CHAR_COUNT - 1 - 3;
    body = body.slice(0, maxBodyLen) + "...";
  }

  return `${body} ${locationUrl}`;
}

/**
 * Fetch Upload records associated with the order's location, ordered by most
 * recent. Returns up to 4 items (Twitter's media-per-tweet limit).
 */
async function fetchMediaForOrder(order: Order): Promise<MediaItem[]> {
  try {
    const uploads = await Upload.find({
      where: { location: { id: order.location.id } },
      order: { createdAt: "DESC" },
      take: 4,
    });

    return uploads.map((upload) => ({
      url: `https://${
        process.env.UPLOAD_S3_BUCKET || "reports.polls.pizza"
      }.s3.us-west-2.amazonaws.com/${upload.filePath}`,
      altText: `Line at ${order.location.address}, ${order.location.city}`,
      isVideo:
        upload.filePath.endsWith(".mp4") || upload.filePath.endsWith(".mov"),
    }));
  } catch (err) {
    console.warn("Twitter: failed to fetch media for order:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Media upload — images (simple multipart)
// ---------------------------------------------------------------------------

async function uploadImage(media: MediaItem): Promise<string | null> {
  // Download the image from S3
  const downloadResponse = await fetch(media.url);
  if (!downloadResponse.ok) {
    throw new Error(
      `Failed to download image: ${downloadResponse.status} ${downloadResponse.statusText}`
    );
  }
  const buffer = Buffer.from(await downloadResponse.arrayBuffer());

  // Max image size: 5 MB — skip without throwing so other media can proceed
  if (buffer.length > 5 * 1024 * 1024) {
    console.warn(
      `Twitter: image too large (${buffer.length} bytes), skipping: ${media.url}`
    );
    return null;
  }

  // Build multipart form
  const form = new FormData();
  const contentType =
    downloadResponse.headers.get("content-type") || "image/jpeg";
  form.append("media", buffer, {
    filename: "media.jpg",
    contentType,
  });

  const baseUrl = `${TWITTER_UPLOAD_BASE}/1.1/media/upload.json`;
  const oauthHeader = generateOAuthHeader("POST", baseUrl);
  const formHeaders = form.getHeaders();
  const formBody = form.getBuffer();

  const uploadResponse = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: oauthHeader,
      ...formHeaders,
    },
    body: formBody,
  });

  if (!uploadResponse.ok) {
    const errBody = await uploadResponse.json().catch(() => ({}));
    throw new Error(
      `Twitter image upload failed: ${uploadResponse.status} ${JSON.stringify(
        errBody
      )}`
    );
  }

  const uploadData = (await uploadResponse.json()) as TwitterMediaUploadResponse;

  // Set alt text (best-effort)
  await setAltText(uploadData.media_id_string, media.altText);

  return uploadData.media_id_string;
}

// ---------------------------------------------------------------------------
// Media upload — videos (chunked INIT → APPEND → FINALIZE → STATUS)
// ---------------------------------------------------------------------------

async function uploadVideo(media: MediaItem): Promise<string | null> {
  // Download the video
  const downloadResponse = await fetch(media.url);
  if (!downloadResponse.ok) {
    throw new Error(
      `Failed to download video: ${downloadResponse.status} ${downloadResponse.statusText}`
    );
  }
  const buffer = Buffer.from(await downloadResponse.arrayBuffer());

  // Max video size: 512 MB
  if (buffer.length > 512 * 1024 * 1024) {
    console.warn(
      `Twitter: video too large (${buffer.length} bytes), skipping: ${media.url}`
    );
    return null;
  }

  const mediaType = media.url.endsWith(".mov")
    ? "video/quicktime"
    : "video/mp4";

  // --- STEP 1: INIT ---
  const initParams: Record<string, string> = {
    command: "INIT",
    media_type: mediaType,
    total_bytes: buffer.length.toString(),
  };
  const initBaseUrl = `${TWITTER_UPLOAD_BASE}/1.1/media/upload.json`;
  const initOAuth = generateOAuthHeader("POST", initBaseUrl, initParams);

  const initResponse = await fetch(initBaseUrl, {
    method: "POST",
    headers: {
      Authorization: initOAuth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(initParams).toString(),
  });

  if (!initResponse.ok) {
    const errBody = await initResponse.json().catch(() => ({}));
    throw new Error(
      `Twitter video INIT failed: ${initResponse.status} ${JSON.stringify(
        errBody
      )}`
    );
  }

  const initData = (await initResponse.json()) as TwitterMediaUploadResponse;
  const media_id_string = initData.media_id_string;

  // --- STEP 2: APPEND ---
  const appendForm = new FormData();
  appendForm.append("command", "APPEND");
  appendForm.append("media_id", media_id_string);
  appendForm.append("segment_index", "0");
  appendForm.append("media", buffer, {
    filename: "video.mp4",
    contentType: mediaType,
  });

  const appendBaseUrl = `${TWITTER_UPLOAD_BASE}/1.1/media/upload.json`;
  const appendOAuth = generateOAuthHeader("POST", appendBaseUrl);
  const appendHeaders = appendForm.getHeaders();
  const appendBody = appendForm.getBuffer();

  const appendResponse = await fetch(appendBaseUrl, {
    method: "POST",
    headers: {
      Authorization: appendOAuth,
      ...appendHeaders,
    },
    body: appendBody,
  });

  if (!appendResponse.ok) {
    const errBody = await appendResponse.json().catch(() => ({}));
    throw new Error(
      `Twitter video APPEND failed: ${appendResponse.status} ${JSON.stringify(
        errBody
      )}`
    );
  }

  // --- STEP 3: FINALIZE ---
  const finalizeParams: Record<string, string> = {
    command: "FINALIZE",
    media_id: media_id_string,
  };
  const finalizeBaseUrl = `${TWITTER_UPLOAD_BASE}/1.1/media/upload.json`;
  const finalizeOAuth = generateOAuthHeader(
    "POST",
    finalizeBaseUrl,
    finalizeParams
  );

  const finalizeResponse = await fetch(finalizeBaseUrl, {
    method: "POST",
    headers: {
      Authorization: finalizeOAuth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(finalizeParams).toString(),
  });

  if (!finalizeResponse.ok) {
    const errBody = await finalizeResponse.json().catch(() => ({}));
    throw new Error(
      `Twitter video FINALIZE failed: ${
        finalizeResponse.status
      } ${JSON.stringify(errBody)}`
    );
  }

  const finalizeData = (await finalizeResponse.json()) as TwitterMediaUploadResponse;

  // --- STEP 4: Poll STATUS if processing ---
  if (
    finalizeData.processing_info &&
    finalizeData.processing_info.state !== "succeeded"
  ) {
    await waitForProcessing(media_id_string);
  }

  // Set alt text (best-effort)
  await setAltText(media_id_string, media.altText);

  return media_id_string;
}

async function waitForProcessing(
  mediaId: string,
  maxRetries: number = 10
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const statusParams: Record<string, string> = {
      command: "STATUS",
      media_id: mediaId,
    };
    const statusUrl = `${TWITTER_UPLOAD_BASE}/1.1/media/upload.json`;
    const statusOAuth = generateOAuthHeader("GET", statusUrl, statusParams);

    const statusResponse = await fetch(
      `${statusUrl}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      {
        method: "GET",
        headers: {
          Authorization: statusOAuth,
        },
      }
    );

    if (!statusResponse.ok) {
      console.warn(
        `Twitter: video STATUS check failed: ${statusResponse.status}`
      );
      return;
    }

    const statusData = (await statusResponse.json()) as TwitterMediaUploadResponse;
    const state = statusData.processing_info?.state;

    if (state === "succeeded") {
      return;
    }
    if (state === "failed") {
      console.warn(
        `Twitter: video processing failed: ${JSON.stringify(
          statusData.processing_info?.error
        )}`
      );
      return;
    }

    // Wait before polling again (use check_after_secs if provided)
    const waitSecs = statusData.processing_info?.check_after_secs || 2;
    await new Promise((resolve) => setTimeout(resolve, waitSecs * 1000));
  }

  console.warn(
    `Twitter: video processing status polling exhausted for media ${mediaId}`
  );
}

// ---------------------------------------------------------------------------
// Alt text
// ---------------------------------------------------------------------------

async function setAltText(mediaId: string, altText: string): Promise<void> {
  const baseUrl = `${TWITTER_UPLOAD_BASE}/1.1/media/metadata/create.json`;
  const oauthHeader = generateOAuthHeader("POST", baseUrl);

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: oauthHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      media_id: mediaId,
      alt_text: { text: altText },
    }),
  });

  if (!response.ok) {
    console.warn(
      `Twitter: failed to set alt text for ${mediaId}: ${response.status}`
    );
    // Don't throw — alt text is best-effort
  }
}

// ---------------------------------------------------------------------------
// Post tweet
// ---------------------------------------------------------------------------

async function postTweet(
  text: string,
  mediaIds: string[],
  retryCount: number = 0
): Promise<void> {
  const body: Record<string, unknown> = { text };
  if (mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }

  const baseUrl = `${TWITTER_API_BASE}/2/tweets`;
  const oauthHeader = generateOAuthHeader("POST", baseUrl);

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: oauthHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    return;
  }

  const errorBody = (await response
    .json()
    .catch(() => ({}))) as TwitterErrorResponse;
  await handleTwitterError(
    errorBody,
    response.status,
    text,
    mediaIds,
    retryCount
  );
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

async function handleTwitterError(
  errorBody: TwitterErrorResponse,
  statusCode: number,
  originalText: string,
  mediaIds: string[],
  retryCount: number
): Promise<void> {
  const errors = errorBody?.errors || [];

  for (const err of errors) {
    switch (err.code) {
      case 187:
        // Duplicate tweet — log and continue
        console.warn("Twitter: duplicate tweet detected, continuing");
        return;

      case 186:
        // Tweet too long — truncate and retry once
        console.warn("Twitter: tweet too long, truncating and retrying");
        if (retryCount < 1) {
          const truncated = originalText.slice(0, 277) + "...";
          return postTweet(truncated, mediaIds, retryCount + 1);
        }
        console.error("Twitter: truncation retry also failed, giving up");
        return;

      case 88:
      case 429:
        // Rate limited
        console.error("Twitter: rate limited", JSON.stringify(errorBody));
        return;

      case 32:
      case 89:
      case 99:
        // Auth issues — cannot recover without new tokens
        console.error(
          "Twitter: authentication error, cannot recover",
          JSON.stringify(errorBody)
        );
        return;

      default:
        console.error("Twitter: unexpected error", JSON.stringify(errorBody));
    }
  }

  // Retry on 5xx transient errors
  if (statusCode >= 500 && retryCount < 1) {
    console.warn("Twitter: 5xx error, retrying once");
    return postTweet(originalText, mediaIds, retryCount + 1);
  }

  // Non-retriable error
  throw new Error(
    `Twitter API error: ${statusCode} ${JSON.stringify(errorBody)}`
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Post an order summary to Twitter.
 *
 * This function is designed to be called as a fire-and-forget operation —
 * it never throws, and failures are logged rather than propagated.
 *
 * @param order  The placed order to announce
 */
export async function twitterPost(order: Order): Promise<void> {
  // Skip if Twitter is not configured
  if (!process.env.TWITTER_API_KEY) {
    return;
  }

  try {
    const text = buildTweetText(order);
    const mediaItems = await fetchMediaForOrder(order);
    const mediaIds: string[] = [];

    for (const media of mediaItems) {
      try {
        let id: string | null;
        if (media.isVideo) {
          id = await uploadVideo(media);
        } else {
          id = await uploadImage(media);
        }
        if (id) {
          mediaIds.push(id);
        }
      } catch (err) {
        console.error(`Twitter: failed to upload media ${media.url}:`, err);
        // Continue with other media
      }
    }

    await postTweet(text, mediaIds);
  } catch (err) {
    console.error("Twitter: failed to post order update:", err);
    notifyBugsnag(err as Error);
  }
}
