/**
 * Centralized "is this social platform configured?" check.
 *
 * A platform is considered configured only when every required secret is
 * present and non-empty. This lets each posting module treat "not configured"
 * as a clean no-op instead of a runtime error, so staging deploys without
 * social credentials succeed without error logs or Bugsnag noise.
 */
export function socialEnabled(): Record<"bluesky" | "twitter", boolean> {
  return {
    bluesky: !!(process.env.BSKY_HANDLE && process.env.BSKY_APP_PASSWORD),
    twitter: !!(
      process.env.TWITTER_API_KEY &&
      process.env.TWITTER_API_SECRET &&
      process.env.TWITTER_ACCESS_TOKEN &&
      process.env.TWITTER_ACCESS_SECRET
    ),
  };
}
