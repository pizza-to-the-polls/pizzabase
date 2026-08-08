/**
 * EXIF extraction for images and video.
 *
 * Handles:
 *   - JPEG: reads APP1 markers (0xFFE1) containing Exif\0\0 + TIFF
 *   - PNG: reads eXIf ancillary chunks
 *   - ISO BMFF (HEIC/HEIF/MP4/MOV): navigates ftyp → moov → udta → meta
 *     or moov → trak → mdia → minf → stbl → stsd → sample entry for
 *     Exif uuid boxes
 *
 * All extraction operates on the first 64KB of the file — EXIF data
 * is typically at the start of the file in every supported format.
 */

export { extractExif, stripExifBytes } from "./extract";
export { serializeExif } from "./serialize";
export { reviewExif } from "./review";
export { extractExifAndReview } from "./service";
export { getDigitalSourceType } from "./digitalSourceType";
