/**
 * CDN-backed serving for processed media.
 *
 * Processed outputs (WebP/JPEG/MP4) live in the private reports bucket and
 * are served through the media CloudFront distribution (OAC). Raw uploads
 * are never served.
 *
 * MEDIA_CDN_DOMAIN (e.g. media.polls.pizza) — when unset, consumers fall
 * back to whatever URL is already stored, preserving legacy behavior.
 */

export function mediaCdnBaseUrl(): string {
  const domain = process.env.MEDIA_CDN_DOMAIN;
  return domain ? `https://${domain}` : "";
}

/**
 * Rebuild a stored media URL against the CDN. Stored URLs may be legacy
 * path-style S3 URLs or CDN URLs; both carry the same /uploads/ key path.
 * When no CDN is configured the stored URL is returned unchanged.
 */
export function cdnUrlFromStoredUrl(
  stored: string | null | undefined,
): string | null {
  if (!stored) return null;
  const base = mediaCdnBaseUrl();
  if (!base) return stored;
  const marker = "/uploads/";
  const idx = stored.indexOf(marker);
  if (idx < 0) return stored;
  return `${base}/uploads/${stored.slice(idx + marker.length)}`;
}

/**
 * Build a CDN URL for a storage key ("uploads/...").
 * Returns null when no CDN is configured.
 */
export function cdnUrlForKey(key: string): string | null {
  const base = mediaCdnBaseUrl();
  return base ? `${base}/${key}` : null;
}
