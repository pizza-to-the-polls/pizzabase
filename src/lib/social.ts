import type { Order } from "../entity/Order";
import { blueskyPost } from "./bluesky";
import { twitterPost } from "./twitter";
import { renderMessage } from "./message-templates";
import { collectMedia } from "./media";

/**
 * Fire-and-forget social media posting for a placed order.
 *
 * The same rendered message and media URLs are shared across all platforms
 * so that the quirky template text is consistent on Twitter, BlueSky, and
 * any future social network.
 *
 * Posts to both BlueSky and Twitter concurrently, without blocking the
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

  blueskyPost(order, text, mediaUrls).catch((err) =>
    console.error("BlueSky post failed:", err)
  );
  twitterPost(order, text, mediaUrls).catch((err) =>
    console.error("Twitter post failed:", err)
  );
}
