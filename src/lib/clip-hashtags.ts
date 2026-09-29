/**
 * Deterministic starter hashtag set for a new clip's publish kit.
 *
 * Kept pure and synchronous so output is reproducible for a given
 * city/state pair (same input → same output, no randomness or clocks).
 */

const BASE_HASHTAGS = ["#votingrights", "#ElectionDay"];

// Strip anything that isn't alphanumeric so "#St. Louis" → "#StLouis".
const tagify = (value: string): string =>
  `#${value.replace(/[^a-zA-Z0-9]/g, "")}`;

export function deriveHashtags(city: string, state: string): string[] {
  return [...BASE_HASHTAGS, tagify(state), tagify(city)];
}
