import type { Order } from "../entity/Order";
import { AppDataSource } from "../data-source";
import { IntegrationSession } from "../entity/IntegrationSession";
import { notifyBugsnag } from "./notifyBugsnag";
import { renderMessage, truncateMessage } from "./message-templates";
import { collectMedia, MediaUrls } from "./media";

const THREADS_API_BASE = "https://graph.threads.net/v1.0";
const MAX_THREADS_LENGTH = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAccessToken(): Promise<string | null> {
  try {
    const repo = AppDataSource.getRepository(IntegrationSession);
    const row = await repo.findOne({ where: { service: "threads" } });
    if (row?.credentials?.accessToken) {
      return row.credentials.accessToken;
    }
  } catch (err) {
    console.error("Failed to read Threads token from DB:", err);
  }

  // Fallback for the transition period before the DB is seeded.
  return process.env.THREADS_ACCESS_TOKEN || null;
}

function getUserId(): string {
  const userId = process.env.THREADS_USER_ID;
  if (!userId) {
    throw new Error("THREADS_USER_ID environment variable is not set");
  }
  return userId;
}

/**
 * Make an API call to the Threads Graph API, with one automatic retry on
 * 5xx or network errors.
 */
async function threadsApi(
  endpoint: string,
  body: Record<string, unknown>,
  retryOnTransient: boolean = true
): Promise<Response> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error("Threads access token is not configured");
  }
  const userId = getUserId();
  const url = `${THREADS_API_BASE}/${userId}/${endpoint}`;

  const fetchOpts: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };

  let response = await fetch(url, fetchOpts);

  if (retryOnTransient && (response.status >= 500 || response.status === 0)) {
    response = await fetch(url, fetchOpts);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Text-only posting
// ---------------------------------------------------------------------------

/**
 * Post a simple text-only Thread.
 */
async function postTextOnly(text: string): Promise<void> {
  const response = await threadsApi("threads", {
    text,
    media_type: "TEXT",
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      `Threads text post failed: ${response.status} ${JSON.stringify(
        errorBody
      )}`
    );
  }

  const data = (await response.json()) as { id: string };
  console.log(`Threads text post created: ${data.id}`);
}

// ---------------------------------------------------------------------------
// Media posting (two-step: container → publish)
// ---------------------------------------------------------------------------

/**
 * Post a Thread with an image or video.
 *
 * Threads requires a two-step flow:
 *   1. Create a media container (POST /threads with media_type + url)
 *   2. Publish the container   (POST /threads_publish with creation_id)
 *
 * Media must be at a publicly-accessible URL — Threads downloads it
 * server-side. No binary upload.
 */
async function postMedia(
  text: string,
  imageUrls: string[],
  videoUrls: string[],
  altText: string
): Promise<void> {
  // Try video first, then images (match existing platform preference)
  const allMedia = [
    ...videoUrls.map((url) => ({ url, mediaType: "VIDEO" as const })),
    ...imageUrls.map((url) => ({ url, mediaType: "IMAGE" as const })),
  ];

  for (const media of allMedia) {
    try {
      // Step 1: Create container
      const containerBody: Record<string, unknown> = {
        media_type: media.mediaType,
        text,
      };

      if (media.mediaType === "VIDEO") {
        containerBody.video_url = media.url;
      } else {
        containerBody.image_url = media.url;
      }

      if (altText) {
        containerBody.alt_text = altText;
      }

      const containerResponse = await threadsApi("threads", containerBody);

      if (!containerResponse.ok) {
        const errBody = await containerResponse.json().catch(() => ({}));
        console.error(
          `Threads media container creation failed: ${containerResponse.status}`,
          JSON.stringify(errBody)
        );
        continue;
      }

      const containerData = (await containerResponse.json()) as { id: string };
      const creationId = containerData.id;

      if (!creationId) {
        console.error("Threads media container created but no id returned");
        continue;
      }

      // Step 2: Publish
      const publishResponse = await threadsApi("threads_publish", {
        creation_id: creationId,
      });

      if (!publishResponse.ok) {
        const errBody = await publishResponse.json().catch(() => ({}));
        console.error(
          `Threads media publish failed: ${publishResponse.status}`,
          JSON.stringify(errBody)
        );
        continue;
      }

      const publishData = (await publishResponse.json()) as { id: string };
      console.log(`Threads media post published: ${publishData.id}`);

      // Success — one media is enough; return
      return;
    } catch (err) {
      console.error(`Threads: failed to post media ${media.url}:`, err);
      // Continue to next media
    }
  }

  // If all media failed, fall back to text-only
  if (text) {
    try {
      await postTextOnly(text);
    } catch (err) {
      console.error("Threads: fallback text-only post also failed:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Post an order summary to Threads (Meta).
 *
 * When `text` and `mediaUrls` are provided they are used directly;
 * otherwise they are resolved from the order. This allows the caller to
 * share the same message and media across multiple platforms.
 *
 * This function is designed to be called as a fire-and-forget operation —
 * it never throws, and failures are logged rather than propagated.
 *
 * @param order     The placed order to announce
 * @param text      Optional pre-rendered post text (shared across platforms)
 * @param mediaUrls Optional pre-collected media URLs (shared across platforms)
 */
export async function threadsPost(
  order: Order,
  text?: string,
  mediaUrls?: MediaUrls
): Promise<void> {
  // Skip if Threads is not configured
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return;
  }

  try {
    const finalText = truncateMessage(
      text ?? renderMessage(order),
      MAX_THREADS_LENGTH
    );
    const urls = mediaUrls ?? (await collectMedia(order));

    if (urls.images.length === 0 && urls.videos.length === 0) {
      // No media — simple text-only post
      await postTextOnly(finalText);
    } else {
      await postMedia(finalText, urls.images, urls.videos, urls.alt);
    }

    console.log(`Threads post completed for order ${order.id}`);
  } catch (err) {
    console.error(`Failed to post order ${order.id} to Threads:`, err);
    if (err instanceof Error) {
      notifyBugsnag(err);
    }
  }
}
