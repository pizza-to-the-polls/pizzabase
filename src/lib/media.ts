import type { Order } from "../entity/Order";
import { AppDataSource } from "../data-source";
import { Report } from "../entity/Report";
import { Upload } from "../entity/Upload";
import { cdnUrlFromStoredUrl } from "./media-cdn";

export interface MediaUrls {
  images: string[];
  videos: string[];
  alt: string;
}

const SUPPORTED_VIDEO_FORMATS = ["mp4", "mpeg", "webm", "mov"];
const MAX_IMAGES = 4;
// Twitter allows a single video per tweet and BlueSky embeds one — collecting
// more would cause the whole post to fail at the API layer.
const MAX_VIDEOS = 1;

const MEDIA_URL = /\.(jpg|jpeg|png|gif|webp|bmp|mp4|mpeg|webm|mov)(\?|$)/i;

/**
 * Collect media (images and videos) associated with an order.
 *
 * Sources only the order's own reports — each report's web upload
 * (reports.upload_id) and any MMS replies linked to it (uploads.report_id),
 * falling back to the report's public reportURL — never the location's
 * full upload history. Recurring locations accumulate photos across
 * election cycles, and scanning that history put old photos on new
 * orders' posts (seen on orders 12805–12807). Reports are visited
 * newest-first; images are capped at 4 (BlueSky's limit, which also
 * matches Twitter's) and videos at 1.
 */
export async function collectMedia(order: Order): Promise<MediaUrls> {
  const images: string[] = [];
  const videos: string[] = [];
  const alt = `Long line at ${order.location.address}`;

  const mediaBase = process.env.STATIC_SITE || "https://polls.pizza";

  /**
   * Resolve an upload to a public media URL (null when not usable).
   *
   * Pipeline uploads (rawFilePath set) serve their processed, scrubbed
   * output; the raw file is private. Legacy uploads live in the public
   * bucket under their original key. Stored URLs may predate the CDN —
   * rewrite against the CDN domain.
   */
  const resolveUrl = (upload: Upload): string | null => {
    const ext = upload.filePath.split(".").pop()?.toLowerCase() || "";
    const isVideo = SUPPORTED_VIDEO_FORMATS.includes(ext);

    if (!upload.rawFilePath) {
      return `${mediaBase}/${upload.filePath}`;
    }

    const processed = upload.processedFilePath as Record<string, string> | null;
    if (isVideo) {
      // media_status flips to ready in on-mediaconvert-complete
      return upload.mediaStatus === "ready"
        ? (cdnUrlFromStoredUrl(processed?.mp4) ?? null)
        : null;
    }
    return (
      cdnUrlFromStoredUrl(processed?.webp) ??
      cdnUrlFromStoredUrl(processed?.jpeg) ??
      null
    );
  };

  const addUrl = (url: string): void => {
    const ext = url.split(".").pop()?.toLowerCase() || "";
    const isVideo = SUPPORTED_VIDEO_FORMATS.includes(ext);
    if (isVideo) {
      if (!videos.includes(url) && videos.length < MAX_VIDEOS) videos.push(url);
    } else {
      if (!images.includes(url) && images.length < MAX_IMAGES) images.push(url);
    }
  };

  const reports = await AppDataSource.getRepository(Report).find({
    where: { order: { id: order.id } },
    relations: ["upload"],
    order: { createdAt: "DESC" },
  });

  for (const report of reports) {
    let hasMedia = false;

    // The report's original web upload…
    if (report.upload) {
      const url = resolveUrl(report.upload);
      if (url) {
        addUrl(url);
        hasMedia = true;
      }
    }

    // …then any MMS replies linked to this report, newest-first.
    const mmsUploads = await AppDataSource.getRepository(Upload).find({
      where: { report: { id: report.id } },
      order: { createdAt: "DESC" },
    });
    for (const upload of mmsUploads) {
      const url = resolveUrl(upload);
      if (url) {
        addUrl(url);
        hasMedia = true;
      }
    }

    // Legacy fallback: the report's own public media URL, only when the
    // report has no usable upload (avoids double-listing the same photo
    // under two different hosts).
    if (!hasMedia && report.reportURL && MEDIA_URL.test(report.reportURL)) {
      addUrl(report.reportURL);
    }
  }

  return { images, videos, alt };
}
