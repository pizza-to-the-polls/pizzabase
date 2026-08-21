import type { Order } from "../entity/Order";
import { blueskyPost } from "./bluesky";
import { twitterPost } from "./twitter";
import { threadsPost } from "./threads";
import { renderMessage } from "./message-templates";
import { collectMedia } from "./media";
import { socialEnabled } from "./social-config";

/**
 * Fire-and-forget social media posting for a placed order.
 *
 * The same rendered message and media URLs are shared across all platforms
 * so that the quirky template text is consistent on Twitter, BlueSky, and
 * any future social network.
 *
 * Posts to all configured platforms concurrently, without blocking the
 * response. Individual failures are logged but never propagated.
 */
export async function socialPost(order: Order): Promise<void> {
  const text = renderMessage(order);

  let mediaUrls = { images: [] as string[], videos: [] as string[], alt: "" };
  try {
    mediaUrls = await collectMedia(order);
  } catch (err) {
    console.error("Failed to collect media for order:", err);
  }

  const enabled = socialEnabled();
  if (enabled.bluesky) {
    blueskyPost(order, text, mediaUrls).catch((err) =>
      console.error("BlueSky post failed:", err)
    );
  }
  if (enabled.twitter) {
    twitterPost(order, text, mediaUrls).catch((err) =>
      console.error("Twitter post failed:", err)
    );
  }
  // Threads is NOT gated on env vars here: its access token lives in the DB
  // (refreshed by the scheduled job — see #199), so socialEnabled() cannot
  // see it. threadsPost self-gates via getAccessToken() at runtime.
  threadsPost(order, text, mediaUrls).catch((err) =>
    console.error("Threads post failed:", err)
  );
}
