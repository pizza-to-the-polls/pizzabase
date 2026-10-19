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
 * Posts to all configured platforms concurrently. Individual failures
 * are logged but never propagated, and the returned promise resolves only
 * once every platform attempt has settled — the standalone onSocialPost
 * Lambda freezes its container when the handler returns, so any promise
 * still pending here would be suspended mid-request and never complete.
 */
export async function socialPost(order: Order): Promise<void> {
  console.log(`socialPost: starting for order ${order.id}`);

  const text = renderMessage(order);
  console.log(`socialPost: rendered message (${text.length} chars)`);

  let mediaUrls = { images: [] as string[], videos: [] as string[], alt: "" };
  try {
    mediaUrls = await collectMedia(order);
    console.log(
      `socialPost: collected media — ${mediaUrls.images.length} images, ${mediaUrls.videos.length} videos`,
    );
  } catch (err) {
    console.error("socialPost: failed to collect media:", err);
  }

  const enabled = socialEnabled();
  console.log(
    `socialPost: enabled gates — bluesky=${enabled.bluesky}, twitter=${enabled.twitter}`,
  );

  const attempts: Promise<void>[] = [];

  if (enabled.bluesky) {
    console.log("socialPost: bluesky → attempting…");
    attempts.push(
      blueskyPost(order, text, mediaUrls)
        .then(() => console.log("socialPost: bluesky → completed"))
        .catch((err) => console.error(`socialPost: bluesky → FAILED (${err})`)),
    );
  } else {
    console.log("socialPost: bluesky → skipped (not configured)");
  }

  if (enabled.twitter) {
    console.log("socialPost: twitter → attempting…");
    attempts.push(
      twitterPost(order, text, mediaUrls)
        .then(() => console.log("socialPost: twitter → completed"))
        .catch((err) => console.error(`socialPost: twitter → FAILED (${err})`)),
    );
  } else {
    console.log("socialPost: twitter → skipped (not configured)");
  }

  // Threads self-gates at runtime via getAccessToken() (token lives in DB,
  // not frozen Lambda env vars), so it always attempts here.
  console.log("socialPost: threads → attempting…");
  attempts.push(
    threadsPost(order, text, mediaUrls)
      .then(() => console.log("socialPost: threads → completed"))
      .catch((err) => console.error(`socialPost: threads → FAILED (${err})`)),
  );

  await Promise.allSettled(attempts);
}
