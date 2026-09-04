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
  const diag = {
    bluesky: "unknown",
    twitter: "unknown",
    threads: "unknown",
  };
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
    `socialPost: enabled gates — bluesky=${enabled.bluesky}, twitter=${enabled.twitter}, threads=always`,
  );

  if (enabled.bluesky) {
    diag.bluesky = "attempting…";
    console.log(`socialPost: bluesky → ${diag.bluesky}`);
    blueskyPost(order, text, mediaUrls)
      .then(() => console.log("socialPost: bluesky → completed"))
      .catch((err) => console.error(`socialPost: bluesky → FAILED (${err})`));
  } else {
    diag.bluesky = "skipped (not configured)";
    console.log(`socialPost: bluesky → ${diag.bluesky}`);
  }

  if (enabled.twitter) {
    diag.twitter = "attempting…";
    console.log(`socialPost: twitter → ${diag.twitter}`);
    twitterPost(order, text, mediaUrls)
      .then(() => console.log("socialPost: twitter → completed"))
      .catch((err) => console.error(`socialPost: twitter → FAILED (${err})`));
  } else {
    diag.twitter = "skipped (not configured)";
    console.log(`socialPost: twitter → ${diag.twitter}`);
  }

  // Threads is NOT gated on env vars here: its access token lives in the DB
  // (refreshed by the scheduled job — see #199), so socialEnabled() cannot
  // see it. threadsPost self-gates via getAccessToken() at runtime.
  diag.threads = "attempting…";
  console.log(`socialPost: threads → ${diag.threads}`);
  threadsPost(order, text, mediaUrls)
    .then(() => console.log("socialPost: threads → completed"))
    .catch((err) => console.error(`socialPost: threads → FAILED (${err})`));
}
