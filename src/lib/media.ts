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
  //
  // Selection: an order is placed for the location's OPEN reports (Report
  // .updateOpen links them), and those reports carry the evidence of the
  // line. So pick the uploads filed in the same window as those reports —
  // not a fixed decay, and never uploads tied to older/skipped reports.
  const mediaBase = process.env.STATIC_SITE || "https://polls.pizza";

  const reports = await order.reports;
  let floor: Date | null = null;
  if (reports.length > 0) {
    const earliest = Math.min(...reports.map((r) => r.createdAt.getTime()));
    // Small lead buffer: a photo can land moments before its report.
    floor = new Date(earliest - 5 * 60 * 1000);
  }

  const uploads = (await order.location.uploads)
    .filter((upload) => !floor || upload.createdAt >= floor)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
  const reportRows = await order.reports;
  for (const report of reportRows) {
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
