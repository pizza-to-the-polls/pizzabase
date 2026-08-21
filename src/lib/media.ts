import type { Order } from "../entity/Order";

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

/**
 * Collect media (images and videos) associated with an order.
 *
 * Scans the location's uploads and the order's reports for image and video
 * URLs. URLs are deduplicated across both sources. Images are capped at 4
 * (BlueSky's limit, which also matches Twitter's limit). Videos are not
 * capped (the upload functions apply their own limits per platform).
 */
export async function collectMedia(order: Order): Promise<MediaUrls> {
  const images: string[] = [];
  const videos: string[] = [];
  const address = order.location.address;
  const alt = `Long line at ${address}`;

  // Uploads from location. Media must be publicly reachable — platforms
  // (Threads especially) download it server-side.
  const mediaBase = process.env.STATIC_SITE || "https://polls.pizza";
  const uploads = await order.location.uploads;
  for (const upload of uploads) {
    const url = `${mediaBase}/${upload.filePath}`;
    const ext = upload.filePath.split(".").pop()?.toLowerCase() || "";
    if (SUPPORTED_VIDEO_FORMATS.includes(ext)) {
      videos.push(url);
    } else {
      images.push(url);
    }
  }

  // Reports from order have media URLs
  const reports = await order.reports;
  for (const report of reports) {
    const reportURL = report.reportURL;
    if (
      reportURL &&
      /\.(jpg|jpeg|png|gif|webp|bmp|mp4|mpeg|webm|mov)(\?|$)/i.test(reportURL)
    ) {
      const ext = reportURL.split(".").pop()?.toLowerCase() || "";
      if (SUPPORTED_VIDEO_FORMATS.includes(ext)) {
        if (!videos.includes(reportURL)) videos.push(reportURL);
      } else {
        if (!images.includes(reportURL)) images.push(reportURL);
      }
    }
  }

  return {
    images: images.slice(0, MAX_IMAGES),
    videos: videos.slice(0, MAX_VIDEOS),
    alt,
  };
}
