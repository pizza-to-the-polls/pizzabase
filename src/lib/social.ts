import { Order } from "../entity/Order";
import { blueskyPost } from "./bluesky";
import { twitterPost } from "./twitter";

/**
 * Fire-and-forget social media posting for a placed order.
 *
 * Posts to both BlueSky and Twitter concurrently, without blocking the
 * response. Individual failures are logged but never propagated.
 */
export function socialPost(order: Order): void {
  blueskyPost(order).catch((err) => console.error("BlueSky post failed:", err));
  twitterPost(order).catch((err) => console.error("Twitter post failed:", err));
}
