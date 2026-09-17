import type { Order } from "../entity/Order";
import { IntegrationSession } from "../entity/IntegrationSession";
import { AppDataSource } from "../data-source";
import { QueryFailedError } from "typeorm";
import { notifyBugsnag } from "./notifyBugsnag";
import {
  renderMessage,
  truncateMessage,
  MAX_BLUESKY_LENGTH,
} from "./message-templates";
import { collectMedia, MediaUrls } from "./media";
import { socialEnabled } from "./social-config";

interface SessionData {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
  pdsUrl: string;
}

interface BlobRef {
  $type: string;
  ref: { $link: string };
  mimeType: string;
  size: number;
}

interface ImageEmbed {
  $type: string;
  images: {
    alt: string;
    image: BlobRef;
  }[];
}

interface VideoEmbed {
  $type: string;
  video: BlobRef;
  alt?: string;
}

interface PostRecord {
  $type: string;
  text: string;
  createdAt: string;
  embed?: ImageEmbed | VideoEmbed;
}

interface CreateSessionResponse {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

interface RefreshSessionResponse {
  accessJwt: string;
  refreshJwt: string;
}

interface UploadBlobResponse {
  blob: BlobRef;
}

const BLUESKY_BLOB_LIMIT = 976 * 1024; // ~976 KB
const BLUESKY_VIDEO_LIMIT = 50 * 1024 * 1024; // 50 MB
const SUPPORTED_VIDEO_FORMATS = ["mp4", "mpeg", "webm", "mov", "quicktime"];

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getEnvOrDefault(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

async function apiCall(
  pdsUrl: string,
  accessJwt: string,
  method: string,
  endpoint: string,
  body?: any,
  headers?: Record<string, string>,
  retryOnTransient: boolean = true,
): Promise<Response> {
  const url = `${pdsUrl}/xrpc/${endpoint}`;
  const defaultHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessJwt}`,
    "Content-Type": "application/json",
  };

  const fetchOpts: RequestInit = {
    method,
    headers: { ...defaultHeaders, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  };

  let response = await fetch(url, fetchOpts);

  if (retryOnTransient && (response.status >= 500 || response.status === 0)) {
    // One retry on transient failures
    response = await fetch(url, fetchOpts);
  }

  return response;
}

async function createSession(
  pdsUrl: string,
  handle: string,
  appPassword: string,
): Promise<SessionData> {
  const response = await fetch(
    `${pdsUrl}/xrpc/com.atproto.server.createSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to create BlueSky session: ${response.status} ${body}`,
    );
  }

  const data = (await response.json()) as CreateSessionResponse;
  if (!data.accessJwt || !data.refreshJwt) {
    throw new Error("Invalid session response: missing tokens");
  }
  return {
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
    did: data.did,
    handle: data.handle,
    pdsUrl,
  };
}

async function refreshSession(
  pdsUrl: string,
  refreshJwt: string,
): Promise<{ accessJwt: string; refreshJwt: string }> {
  const response = await fetch(
    `${pdsUrl}/xrpc/com.atproto.server.refreshSession`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${refreshJwt}` },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to refresh BlueSky session: ${response.status}`);
  }

  const data = (await response.json()) as RefreshSessionResponse;
  if (!data.accessJwt || !data.refreshJwt) {
    throw new Error("Invalid refresh response: missing tokens");
  }
  return {
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
  };
}

async function getSession(pdsUrl: string, accessJwt: string): Promise<boolean> {
  const response = await fetch(`${pdsUrl}/xrpc/com.atproto.server.getSession`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessJwt}` },
  });

  return response.ok;
}

function rowToSession(row: IntegrationSession, pdsUrl: string): SessionData {
  return {
    accessJwt: row.credentials.accessJwt,
    refreshJwt: row.credentials.refreshJwt,
    did: row.credentials.did,
    handle: row.credentials.handle,
    pdsUrl,
  };
}

async function getOrCreateSession(): Promise<SessionData> {
  const pdsUrl = getEnvOrDefault("BSKY_PDS_URL", "https://bsky.social");
  const handle = getEnv("BSKY_HANDLE");
  const appPassword = getEnv("BSKY_APP_PASSWORD");

  const repo = AppDataSource.getRepository(IntegrationSession);
  let sessionRow = await repo.findOne({ where: { service: "bluesky" } });

  if (!sessionRow) {
    // No session exists — create a fresh one
    const session = await createSession(pdsUrl, handle, appPassword);

    sessionRow = new IntegrationSession();
    sessionRow.service = "bluesky";
    sessionRow.credentials = {
      accessJwt: session.accessJwt,
      refreshJwt: session.refreshJwt,
      did: session.did,
      handle: session.handle,
    };
    try {
      await repo.save(sessionRow);
    } catch (err) {
      // Only a unique-constraint race (another invocation committed the
      // session between our findOne and save) should fall back to the
      // winner's row. Any other save error (connection failure, FK violation,
      // deadlock...) must propagate — treating it as a race would silently
      // drop the real failure.
      const isUniqueViolation =
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code?: string }).code === "23505";
      if (!isUniqueViolation) {
        throw err;
      }
      // Race: another invocation created the session between findOne and
      // save. Reload the winner's row and use its credentials.
      const existing = await repo.findOne({ where: { service: "bluesky" } });
      if (existing) {
        return rowToSession(existing, pdsUrl);
      }
      // Still nothing? Try saving again (low probability).
      await repo.save(sessionRow);
    }

    return session;
  }

  // Check if the access token is still active
  const isActive = await getSession(pdsUrl, sessionRow.credentials.accessJwt);

  if (isActive) {
    return rowToSession(sessionRow, pdsUrl);
  }

  // Try to refresh
  try {
    const refreshed = await refreshSession(
      pdsUrl,
      sessionRow.credentials.refreshJwt,
    );
    sessionRow.credentials = {
      ...sessionRow.credentials,
      accessJwt: refreshed.accessJwt,
      refreshJwt: refreshed.refreshJwt,
    };
    await repo.save(sessionRow);

    return rowToSession(sessionRow, pdsUrl);
  } catch {
    // Refresh failed — delete the stored session and re-authenticate
    await repo.delete({ service: "bluesky" });

    const session = await createSession(pdsUrl, handle, appPassword);

    sessionRow = new IntegrationSession();
    sessionRow.service = "bluesky";
    sessionRow.credentials = {
      accessJwt: session.accessJwt,
      refreshJwt: session.refreshJwt,
      did: session.did,
      handle: session.handle,
    };
    await repo.save(sessionRow);

    return session;
  }
}

/**
 * Download a blob from a URL and return as a Buffer along with the content type.
 */
async function downloadBlob(
  url: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download blob from ${url}: ${response.status}`);
  }

  const contentType =
    response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return { buffer, contentType };
}

/**
 * Upload a blob to BlueSky.
 *
 * com.atproto.repo.uploadBlob takes the RAW file bytes as the request body
 * with the blob's content type as the Content-Type header. Wrapping the file
 * in multipart/form-data makes the PDS store the entire multipart envelope
 * as the blob (mimeType "multipart/form-data"), which then fails record
 * creation with "Expected image/*".
 */
async function uploadBlob(
  pdsUrl: string,
  accessJwt: string,
  buffer: Buffer,
  mimeType: string,
): Promise<BlobRef> {
  const url = `${pdsUrl}/xrpc/com.atproto.repo.uploadBlob`;

  const send = () =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        "Content-Type": mimeType,
      },
      body: new Uint8Array(buffer),
    });

  let response = await send();

  if (!response.ok && response.status >= 500) {
    // One retry on transient failures — the buffer is reusable
    response = await send();
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to upload blob to BlueSky: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as UploadBlobResponse;
  return data.blob;
}

/**
 * Get the size of a blob at a URL without downloading it (HEAD request).
 * Returns the content-length in bytes, or -1 if unavailable.
 */
async function getBlobSize(url: string): Promise<number> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      return parseInt(contentLength, 10);
    }
    return -1;
  } catch {
    return -1;
  }
}

/**
 * Check if a URL is hosted on polls.pizza/uploads.
 */
function isPollsPizzaUpload(url: string): boolean {
  return url.includes("polls.pizza/uploads/");
}

/**
 * Resize an image via CloudFront by encoding resize params.
 * Preserves the existing Zapier pattern.
 */
function buildCloudFrontResizeUrl(imageUrl: string): string {
  const pathPart = imageUrl.split("polls.pizza/").pop() || "";

  const resizeParams = {
    bucket: "reports.polls.pizza",
    key: pathPart,
    edits: { resize: { width: 750, fit: "inside" } },
  };

  // Match the original Zapier code byte-for-byte: btoa() produces standard
  // padded base64. Do NOT switch to base64url — the CloudFront image handler
  // expects the exact encoding the Zapier integration used.
  const encodedParams = Buffer.from(JSON.stringify(resizeParams)).toString(
    "base64",
  );
  return `https://d120oba23kfdpx.cloudfront.net/${encodedParams}`;
}

/**
 * Try to upload an image, applying CloudFront resize if necessary.
 */
async function uploadImage(
  pdsUrl: string,
  accessJwt: string,
  imageUrl: string,
): Promise<{ blob: BlobRef } | null> {
  let size = await getBlobSize(imageUrl);

  // If > 976 KB and hosted on polls.pizza, resize via CloudFront
  if (size > BLUESKY_BLOB_LIMIT && isPollsPizzaUpload(imageUrl)) {
    const resizedUrl = buildCloudFrontResizeUrl(imageUrl);
    console.log(
      `Image too large (${size} bytes), resizing via CloudFront: ${resizedUrl}`,
    );
    size = await getBlobSize(resizedUrl);
    if (size <= BLUESKY_BLOB_LIMIT || size === -1) {
      imageUrl = resizedUrl;
    }
  }

  // If still too large after resize (or not on polls.pizza), skip
  if (size > BLUESKY_BLOB_LIMIT) {
    console.warn(
      `Image at ${imageUrl} exceeds BlueSky blob limit (${size} > ${BLUESKY_BLOB_LIMIT}), skipping`,
    );
    return null;
  }

  try {
    const { buffer, contentType } = await downloadBlob(imageUrl);

    // Double-check actual size after download
    if (buffer.byteLength > BLUESKY_BLOB_LIMIT) {
      if (isPollsPizzaUpload(imageUrl)) {
        // Already resized; give up
        console.warn(
          `Resized image still exceeds BlueSky blob limit (${buffer.byteLength} bytes), skipping`,
        );
        return null;
      }
      console.warn(
        `Image at ${imageUrl} exceeds BlueSky blob limit (${buffer.byteLength} bytes), skipping`,
      );
      return null;
    }

    const blob = await uploadBlob(pdsUrl, accessJwt, buffer, contentType);
    return { blob };
  } catch (err) {
    console.error(`Failed to upload image ${imageUrl}:`, err);
    return null;
  }
}

/**
 * Validate video against BlueSky constraints.
 */
function isValidVideoFormat(contentType: string): boolean {
  const ext = contentType.split("/").pop() || "";
  return SUPPORTED_VIDEO_FORMATS.includes(ext);
}

/**
 * Resolve the mimeType to declare for a video blob.
 *
 * Storage/transcode layers sometimes serve MP4-family content with
 * non-canonical types (e.g. MediaConvert output served as video/x-m4v) —
 * BlueSky rejects records whose mimeType doesn't match its own sniffing
 * ("Expected video/mp4"). Trust the URL extension first, fall back to the
 * served content-type, and normalize known-equivalent types to mp4.
 */
function resolveVideoMimeType(
  videoUrl: string,
  servedContentType: string,
): string {
  const ext = videoUrl.split(".").pop()?.toLowerCase() || "";
  const EXT_MIME: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mpeg: "video/mpeg",
  };
  if (EXT_MIME[ext]) {
    return EXT_MIME[ext];
  }
  if (servedContentType === "video/x-m4v") {
    return "video/mp4";
  }
  return servedContentType;
}

/**
 * Upload a video blob to BlueSky, streaming the download into the upload
 * request. Buffering a 50 MB video into memory is wasteful and risks OOM on
 * memory-constrained Lambdas; a stream keeps memory flat regardless of size.
 *
 * A consumed stream cannot be rewound, so a 5xx retry re-downloads the video
 * instead of reusing the stream.
 */
async function uploadVideoBlob(
  pdsUrl: string,
  accessJwt: string,
  videoUrl: string,
  alt?: string,
): Promise<{
  blob: BlobRef;
  alt?: string;
} | null> {
  const size = await getBlobSize(videoUrl);

  if (size > BLUESKY_VIDEO_LIMIT) {
    console.warn(
      `Video at ${videoUrl} exceeds BlueSky limit (${size} > ${BLUESKY_VIDEO_LIMIT}), skipping`,
    );
    return null;
  }

  try {
    const downloadResponse = await fetch(videoUrl);
    if (!downloadResponse.ok) {
      throw new Error(
        `Failed to download video from ${videoUrl}: ${downloadResponse.status}`,
      );
    }

    const servedContentType =
      downloadResponse.headers.get("content-type") ||
      "application/octet-stream";
    const contentType = resolveVideoMimeType(videoUrl, servedContentType);
    console.log(
      `[bluesky] video ${videoUrl}: served as ${servedContentType}, uploading as ${contentType}`,
    );
    if (!isValidVideoFormat(contentType)) {
      console.warn(`Unsupported video format: ${contentType}, skipping`);
      return null;
    }

    const url = `${pdsUrl}/xrpc/com.atproto.repo.uploadBlob`;
    const headers = {
      Authorization: `Bearer ${accessJwt}`,
      "Content-Type": contentType,
    };

    if (downloadResponse.body) {
      const send = (body: ReadableStream<Uint8Array>) =>
        fetch(url, {
          method: "POST",
          headers,
          body: body as any,
          // undici requires duplex "half" for streaming request bodies
          duplex: "half",
        } as RequestInit);

      let uploadResponse = await send(downloadResponse.body);

      if (uploadResponse.status >= 500) {
        // Stream is consumed — re-download and retry once
        const retryDownload = await fetch(videoUrl);
        if (retryDownload.ok && retryDownload.body) {
          uploadResponse = await send(retryDownload.body);
        }
      }

      if (!uploadResponse.ok) {
        const text = await uploadResponse.text();
        throw new Error(
          `Failed to upload blob to BlueSky: ${uploadResponse.status} ${text}`,
        );
      }

      const data = (await uploadResponse.json()) as UploadBlobResponse;
      return { blob: data.blob, alt };
    }

    // Buffered fallback (older runtimes without streaming response bodies)
    const arrayBuffer = await downloadResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength > BLUESKY_VIDEO_LIMIT) {
      console.warn(
        `Video exceeds BlueSky limit (${buffer.byteLength} bytes), skipping`,
      );
      return null;
    }

    const blob = await uploadBlob(pdsUrl, accessJwt, buffer, contentType);
    return { blob, alt };
  } catch (err) {
    console.error(`Failed to upload video ${videoUrl}:`, err);
    return null;
  }
}

/**
 * Build the BlueSky post embed from pre-collected media.
 * Videos are preferred over images (as per spec).
 */
async function buildEmbed(
  pdsUrl: string,
  accessJwt: string,
  mediaUrls: MediaUrls,
): Promise<ImageEmbed | VideoEmbed | undefined> {
  const { images, videos, alt } = mediaUrls;

  // Try video first (preferred per spec)
  if (videos.length > 0) {
    for (const videoUrl of videos) {
      const result = await uploadVideoBlob(pdsUrl, accessJwt, videoUrl, alt);
      if (result) {
        return {
          $type: "app.bsky.embed.video",
          video: result.blob,
          alt: result.alt,
        };
      }
    }
    console.warn("All video uploads failed, falling back to images");
  }

  // Try images
  if (images.length > 0) {
    const uploadedImages: { alt: string; image: BlobRef }[] = [];

    for (const imageUrl of images) {
      const result = await uploadImage(pdsUrl, accessJwt, imageUrl);
      if (result) {
        uploadedImages.push({ alt, image: result.blob });
      }
    }

    if (uploadedImages.length > 0) {
      return {
        $type: "app.bsky.embed.images",
        images: uploadedImages,
      };
    }
  }

  return undefined;
}

/**
 * Create the BlueSky post record.
 */
async function createPost(
  pdsUrl: string,
  accessJwt: string,
  did: string,
  text: string,
  mediaUrls: MediaUrls,
): Promise<void> {
  const embed = await buildEmbed(pdsUrl, accessJwt, mediaUrls);

  const record: PostRecord = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
  };

  if (embed) {
    record.embed = embed;
  }

  const body = {
    repo: did,
    collection: "app.bsky.feed.post",
    record,
  };

  const response = await apiCall(
    pdsUrl,
    accessJwt,
    "POST",
    "com.atproto.repo.createRecord",
    body,
    undefined,
    true,
  );

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Failed to create BlueSky post: ${response.status} ${responseBody}`,
    );
  }
}

/**
 * Main entry point: post an order summary to BlueSky.
 *
 * When `text` and `mediaUrls` are provided they are used directly;
 * otherwise they are resolved from the order. This allows the caller to
 * share the same message and media across multiple platforms.
 *
 * This is fire-and-forget — errors are logged but never thrown to the caller.
 */
export async function blueskyPost(
  order: Order,
  text?: string,
  mediaUrls?: MediaUrls,
): Promise<void> {
  if (!socialEnabled().bluesky) {
    return; // not configured — clean no-op
  }

  try {
    const session = await getOrCreateSession();
    const finalText = truncateMessage(
      text ?? renderMessage(order),
      MAX_BLUESKY_LENGTH,
    );
    const urls = mediaUrls ?? (await collectMedia(order));
    await createPost(
      session.pdsUrl,
      session.accessJwt,
      session.did,
      finalText,
      urls,
    );
    console.log(`BlueSky post created for order ${order.id}`);
  } catch (err) {
    console.error(`Failed to post order ${order.id} to BlueSky:`, err);
    if (err instanceof Error) {
      notifyBugsnag(err);
    }
  }
}
