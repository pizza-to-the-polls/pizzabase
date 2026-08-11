/**
 * Shared utilities for EXIF scrubbing used by the processing Lambda.
 *
 * Strips PII-sensitive EXIF tags from raw TIFF/EXIF data before the
 * scrubbed copy is written to S3.
 */

// Serial-number-related EXIF tag names
const SERIAL_TAG_NAMES = new Set<string>([
  "BodySerialNumber",
  "CameraSerialNumber",
  "SerialNumber",
  "LensSerialNumber",
  "InternalSerialNumber",
]);

// Timestamp-related EXIF tag names (strip from scrubbed copy)
const TIMESTAMP_TAG_NAMES = new Set<string>([
  "DateTimeOriginal",
  "DateTimeDigitized",
  "DateTime",
  "SubSecTimeOriginal",
  "SubSecTimeDigitized",
]);

/**
 * Strip PII from a parsed EXIF object and return a clean copy.
 *
 * This returns a new object with all GPS tags, serial numbers, and
 * timestamps removed. It mutates nothing – the caller must re-serialize
 * the TIFF from this cleaned map if they need a binary representation.
 */
export function scrubExifData(
  exifData: Record<string, unknown>
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [groupName, groupValue] of Object.entries(exifData)) {
    if (typeof groupValue !== "object" || groupValue === null) {
      cleaned[groupName] = groupValue;
      continue;
    }

    const cleanedGroup: Record<string, unknown> = {};
    const group = groupValue as Record<string, unknown>;

    for (const [tagName, tagValue] of Object.entries(group)) {
      // Scrub GPS IFD entirely (the tag names have numeric IDs as keys
      // when coming from exif-reader, or string names like GPSLatitude).
      if (groupName === "GPSInfo" || groupName === "gps") {
        continue;
      }

      // Scrub serial-number and timestamp tags by name.
      if (SERIAL_TAG_NAMES.has(tagName)) {
        continue;
      }
      if (TIMESTAMP_TAG_NAMES.has(tagName)) {
        continue;
      }

      cleanedGroup[tagName] = tagValue;
    }

    // Only include group if it has content and is not GPSInfo.
    if (
      groupName !== "GPSInfo" &&
      groupName !== "gps" &&
      Object.keys(cleanedGroup).length > 0
    ) {
      cleaned[groupName] = cleanedGroup;
    }
  }

  return cleaned;
}

/**
 * PII-sensitive tags that should be stripped from the scrubbed copy.
 */
export const PII_TAG_LIST = [
  ...SERIAL_TAG_NAMES,
  ...TIMESTAMP_TAG_NAMES,
  "GPSInfo",
  "gps",
] as const;