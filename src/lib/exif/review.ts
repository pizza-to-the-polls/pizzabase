/**
 * Heuristic assessment of EXIF data.
 *
 * Determines:
 *   - Whether the image is likely a camera photo or a screenshot/generated image
 *   - Whether GPS data is present
 *   - Whether the file has been processed by known software (Photoshop, etc.)
 *
 * The function accepts raw exif-reader output (which may contain Buffer
 * and Date objects) BEFORE serialization so it can inspect fields that
 * the serializer may transform.
 */

export interface ExifReview {
  /** "camera" | "screenshot" | "unknown" */
  source: "camera" | "screenshot" | "unknown";
  /** Whether GPS coordinates are embedded */
  hasGps: boolean;
  /** Detected software (Photoshop, GIMP, iOS, etc.) */
  software: string | null;
  /** Camera make + model string */
  camera: string | null;
  /** ISO string of the capture timestamp */
  capturedAt: string | null;
  /** Image dimensions in pixels */
  dimensions: { width: number; height: number } | null;
}

/**
 * Review raw EXIF data (as returned by exif-reader) and return a
 * structured assessment.
 *
 * exif-reader returns group names in lowercase (`image`, `exif`,
 * `gps`). Some callers may pass capitalized keys from mocks or
 * other parsers, so we check both.
 */
export function reviewExif(exifData: Record<string, any> | null): ExifReview {
  if (!exifData) {
    return {
      source: "unknown",
      hasGps: false,
      software: null,
      camera: null,
      capturedAt: null,
      dimensions: null,
    };
  }

  const image = exifData.image || exifData.Image || {};
  const exif = exifData.exif || exifData.Photo || {};
  const gps = exifData.gps || exifData.GPSInfo;

  const hasGps = hasGpsInfo(gps);

  // Image dimensions
  const width =
    image.ImageWidth || exif.PixelXDimension || exifData.ExifImageWidth;
  const height =
    image.ImageHeight || exif.PixelYDimension || exifData.ExifImageHeight;

  const dimensions = width && height ? { width, height } : null;

  // Camera detection
  const make = image.Make;
  const model = image.Model;
  const software: string | null = image.Software || null;
  const userComment = exif.UserComment || null;
  const imageDescription = image.ImageDescription || null;

  // Collect text fields that may contain screenshot markers
  const textHints = [toString(userComment), toString(imageDescription)].filter(
    Boolean
  );

  // Determine source
  let source: "camera" | "screenshot" | "unknown" = "unknown";

  if (make && model) {
    source = "camera";
  } else if (
    isScreenshotSoftware(software) ||
    hasScreenshotMarkers(textHints)
  ) {
    // Software or user comment explicitly indicates screenshot
    source = "screenshot";
  } else if (
    !make &&
    !model &&
    !software &&
    !hasGps &&
    textHints.length === 0
  ) {
    // Totally bare — could be a screenshot or web download
    source = "unknown";
  }

  const camera = make || model ? [make, model].filter(Boolean).join(" ") : null;

  // Capture timestamp
  const capturedAt =
    toString(exif.DateTimeOriginal) ||
    toString(image.DateTimeOriginal) ||
    toString(exif.DateTimeDigitized) ||
    null;

  return {
    source,
    hasGps,
    software,
    camera,
    capturedAt,
    dimensions,
  };
}

// ── Helpers ──────────────────────────────────────────────

function toString(v: any): string | null {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return v.toString("utf-8");
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function hasGpsInfo(gps: any): boolean {
  if (!gps) return false;
  return (
    (typeof gps.GPSLatitude === "number" || gps.GPSLatitude != null) &&
    (typeof gps.GPSLongitude === "number" || gps.GPSLongitude != null)
  );
}

const SCREENSHOT_SOFTWARE_PATTERNS = [
  /^Screenshot/i,
  /^Snagit/i,
  /^Skitch/i,
  /^Screen Shot/i,
  /^ScreenShot/i,
  /^Gyazo/i,
  /^Lightshot/i,
  /^Greenshot/i,
  /^ShareX/i,
  /^CleanShot/i,
  /^Zight/i,
];

function isScreenshotSoftware(sw: string | null): boolean {
  if (!sw) return false;
  return SCREENSHOT_SOFTWARE_PATTERNS.some((pattern) => pattern.test(sw));
}

/** Check UserComment / ImageDescription for screenshot keywords. */
function hasScreenshotMarkers(texts: string[]): boolean {
  const markers = /screenshot|screen.?shot|screen.?capture/i;
  return texts.some((t) => markers.test(t));
}
