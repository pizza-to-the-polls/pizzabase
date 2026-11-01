import { Report } from "../entity/Report";

/**
 * Street View proxy for trusted reports without media.
 *
 * `GET /reports/:id/streetview` (ReportsController.streetview) fetches a
 * Google Street View Static API image for the report's location
 * server-side and returns the bytes — the API key never leaves the
 * Lambda. The route replaces the old `http://trusted.url/<uuid>` symlink
 * noise as the report's public URL:
 *
 *  - external surfaces that link reportURL (Help Scout "Report" link,
 *    #feed-success, Retool, the public /deliveries + /activity pages)
 *    resolve to a real image of the location instead of a dead link
 *  - feedbot's collectMedia never attaches it — the URL has no media
 *    extension, so the MEDIA_URL fallback regex skips it → text-only
 *    posts (Nina's requirement: placeholders never reach social)
 *  - no Upload row is created, so nothing enters the media pipeline
 *    (EXIF/moderation) and Retool's media viewer stays empty
 */

const TRUSTED_URL_PREFIX = "http://trusted.url/";

const apiBase = (): string =>
  process.env.PIZZABASE_API_URL || "https://base.polls.pizza";

export const reportStreetViewUrl = (reportId: number | string): string =>
  `${apiBase()}/reports/${reportId}/streetview`;

export interface StreetViewImage {
  bytes: Buffer;
  contentType: string;
}

/**
 * Fetch a Street View image for a location. Returns null when unavailable
 * (no API key, no imagery, network failure) — never throws, so the route
 * degrades to 404 rather than a 500.
 */
export const fetchStreetViewImage = async (
  lat: string,
  lng: string,
): Promise<StreetViewImage | null> => {
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) {
    console.log(
      JSON.stringify({ event: "streetview_skipped", reason: "no_api_key" }),
    );
    return null;
  }

  const params = new URLSearchParams({
    size: "640x480",
    location: `${lat},${lng}`,
    // Error status (404) instead of the gray "no imagery" placeholder, so
    // uncovered addresses are distinguishable from real images.
    "return-error-code": "true",
    key,
  });

  try {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`,
    );
    if (!resp.ok) {
      console.log(
        JSON.stringify({
          event: "streetview_unavailable",
          status: resp.status,
        }),
      );
      return null;
    }

    const bytes = Buffer.from(await resp.arrayBuffer());
    if (bytes.length < 1024) {
      // Error bodies are tiny; real 640x480 JPEGs are not.
      console.log(JSON.stringify({ event: "streetview_unavailable" }));
      return null;
    }

    const contentType = resp.headers?.get?.("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;

    return { bytes, contentType };
  } catch (_e) {
    console.log(JSON.stringify({ event: "streetview_unavailable" }));
    return null;
  }
};

/**
 * Swap a trusted submission's placeholder reportURL for the Street View
 * proxy URL scoped to the saved report id. No-ops when the submitter
 * supplied media (their URL is a real permalink) and for public reports
 * (url is required, no placeholder exists to swap).
 */
export const attachStreetViewUrl = async (report: Report): Promise<void> => {
  if (!report.reportURL?.startsWith(TRUSTED_URL_PREFIX)) return;
  report.reportURL = reportStreetViewUrl(report.id);
  await report.save();
};
