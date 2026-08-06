/**
 * EXIF review heuristic – deterministic, rule-based guidance for human reviewers.
 *
 * This module produces a small, explainable summary alongside the raw EXIF
 * data. It does NOT classify images as genuine/fake; it surfaces signals that
 * help a human volunteer decide whether the metadata is consistent with a
 * camera capture, a screenshot, or something else.
 *
 * Rules are pure and table-driven. No LLM or visual analysis.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Signal {
  code: string;
  label: string;
}

export type Assessment =
  | "likely-camera-capture"
  | "likely-screen-or-software-generated"
  | "limited-evidence"
  | "no-metadata"
  | "conflicting-evidence";

export type Confidence = "low" | "medium" | "high";

export interface ReviewResult {
  assessment: Assessment;
  confidence: Confidence;
  positiveSignals: Signal[];
  cautionSignals: Signal[];
  missingSignals: string[];
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Exif-like type – what we accept from callers
// ---------------------------------------------------------------------------

/** Loosely-typed parsed EXIF (post-serialization or raw from exif-reader). */
export type ExifData = Record<string, unknown> | null | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val === "string") return val;
  if (Buffer.isBuffer(val)) return val.toString("utf-8");
  // Handle serialized { _bytes: "<base64>" } format from serializeExif
  if (
    val !== null &&
    typeof val === "object" &&
    "_bytes" in (val as Record<string, unknown>)
  ) {
    try {
      return Buffer.from(
        (val as Record<string, unknown>)._bytes as string,
        "base64"
      ).toString("utf-8");
    } catch {
      return null;
    }
  }
  return null;
}

function num(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  return null;
}

function has(obj: unknown, key: string): boolean {
  if (obj === null || obj === undefined || typeof obj !== "object")
    return false;
  return key in (obj as Record<string, unknown>);
}

function get(obj: unknown, key: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== "object")
    return undefined;
  return (obj as Record<string, unknown>)[key];
}

function getStr(obj: unknown, key: string): string | null {
  return str(get(obj, key));
}

function containsWordCI(haystack: string | null, word: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(word.toLowerCase());
}

/**
 * Decode a UserComment value from raw EXIF data.
 *
 * EXIF UserComment (tag 0x9286, UNDEFINED type) has an 8-byte encoding
 * preamble: "ASCII\0\0\0", "JIS\0\0\0\0\0", "UNICODE\0", or 8 null bytes.
 * We strip the preamble and decode the payload accordingly.
 */
function decodeUserComment(val: unknown): string {
  if (Buffer.isBuffer(val)) {
    if (val.length <= 8) return val.toString("utf-8");
    const preamble = val.toString("ascii", 0, 8);
    const data = val.slice(8);
    if (preamble.startsWith("ASCII")) return data.toString("ascii");
    if (preamble.startsWith("UNICODE")) {
      // EXIF specifies UCS-2 with byte order inherited from the TIFF header,
      // but exif-reader doesn't expose that relationship on the value. Decode
      // both byte orders for review-marker matching.
      const littleEndian = data.toString("utf16le").replace(/\0/g, "");
      const swapped = Buffer.alloc(data.length);
      for (let index = 0; index + 1 < data.length; index += 2) {
        swapped[index] = data[index + 1];
        swapped[index + 1] = data[index];
      }
      const bigEndian = swapped.toString("utf16le").replace(/\0/g, "");
      return `${littleEndian} ${bigEndian}`;
    }
    if (preamble.startsWith("JIS")) return data.toString("ascii"); // simplified
    // No recognized 8-byte preamble: decode the complete value. Many tools
    // store plain ASCII despite EXIF declaring the field as UNDEFINED.
    return val.toString("ascii");
  }
  return str(val) || "";
}

// ---------------------------------------------------------------------------
// IFD group names used by exif-reader
// ---------------------------------------------------------------------------

const IFD_GROUPS = ["Image", "Photo", "GPSInfo", "Thumbnail", "Interop"];

function hasAnyIfdData(data: ExifData): boolean {
  // Guard: also treat the pseudo-IFD keys that exif-reader attaches
  // (bigEndian, hasThumbnail, etc.) as sign of parsed output.
  // But we specifically look for actual IFD groups with content.
  if (!data || typeof data !== "object") return false;
  const entries = data as Record<string, unknown>;
  return IFD_GROUPS.some((k) => {
    const group = entries[k];
    return (
      group !== null &&
      typeof group === "object" &&
      Object.keys(group as object).length > 0
    );
  });
}

// ---------------------------------------------------------------------------
// Signal detection
// ---------------------------------------------------------------------------

interface SignalDetector {
  code: string;
  label: string;
  category: "positive" | "caution";
  required?: boolean; // if true, absence → missingSignals
  detect: (data: ExifData) => boolean;
}

/**
 * All defined signal detectors.
 *
 * A "positive" signal is evidence consistent with camera capture.
 * A "caution" signal is evidence that should give a reviewer pause.
 *
 * These are NOT proofs; they are patterns that a volunteer reviewer
 * should weigh together.
 */
const DETECTORS: SignalDetector[] = [
  // ---- POSITIVE ----
  {
    code: "camera-make-model",
    label: "Camera make and model present",
    category: "positive",
    required: true,
    detect: (d) => {
      const img = get(d, "Image");
      return !!getStr(img, "Make") || !!getStr(img, "Model");
    },
  },
  {
    code: "maker-note",
    label: "Vendor MakerNote payload present",
    category: "positive",
    required: false,
    detect: (d) => {
      const photo = get(d, "Photo");
      return has(photo, "MakerNote");
    },
  },
  {
    code: "body-serial-number",
    label: "Camera body serial number present",
    category: "positive",
    required: false,
    detect: (d) => {
      const photo = get(d, "Photo");
      const img = get(d, "Image");
      return (
        has(photo, "BodySerialNumber") ||
        has(photo, "SerialNumber") ||
        has(img, "BodySerialNumber") ||
        has(img, "CameraSerialNumber")
      );
    },
  },
  {
    code: "lens-info",
    label: "Lens information present",
    category: "positive",
    required: false,
    detect: (d) => {
      const photo = get(d, "Photo");
      return (
        !!getStr(photo, "LensMake") ||
        !!getStr(photo, "LensModel") ||
        has(photo, "LensSerialNumber") ||
        has(photo, "LensSpecification")
      );
    },
  },
  {
    code: "image-unique-id",
    label: "Image unique ID present",
    category: "positive",
    required: false,
    detect: (d) => {
      const photo = get(d, "Photo");
      return !!getStr(photo, "ImageUniqueID");
    },
  },
  {
    code: "optical-settings",
    label: "Optical / exposure settings present",
    category: "positive",
    required: true,
    detect: (d) => {
      const photo = get(d, "Photo");
      const img = get(d, "Image");
      return (
        num(get(photo, "ExposureTime")) !== null ||
        num(get(photo, "FNumber")) !== null ||
        num(get(img, "FNumber")) !== null ||
        num(get(photo, "ISOSpeedRatings")) !== null ||
        num(get(photo, "PhotographicSensitivity")) !== null ||
        num(get(photo, "FocalLength")) !== null ||
        num(get(photo, "FocalLengthIn35mmFilm")) !== null
      );
    },
  },
  {
    code: "capture-timestamp",
    label: "Capture timestamp present",
    category: "positive",
    required: true,
    detect: (d) => {
      const photo = get(d, "Photo");
      const img = get(d, "Image");
      return (
        has(photo, "DateTimeOriginal") ||
        has(photo, "DateTimeDigitized") ||
        has(img, "DateTimeOriginal") ||
        has(img, "DateTime")
      );
    },
  },
  {
    code: "exif-dimensions",
    label: "EXIF pixel dimensions present",
    category: "positive",
    required: false,
    detect: (d) => {
      const photo = get(d, "Photo");
      return (
        num(get(photo, "PixelXDimension")) !== null &&
        num(get(photo, "PixelYDimension")) !== null
      );
    },
  },
  {
    code: "gps-data",
    label: "GPS location data present",
    category: "positive",
    required: false,
    detect: (d) => {
      const gps = get(d, "GPSInfo");
      if (!gps || typeof gps !== "object") return false;
      return (
        has(gps, "GPSLatitude") ||
        has(gps, "GPSLongitude") ||
        has(gps, "GPSLatitudeRef") ||
        has(gps, "GPSLongitudeRef")
      );
    },
  },

  // ---- CAUTION ----
  {
    code: "explicit-screenshot-marker",
    label: "Metadata identifies this image as a screenshot",
    category: "caution",
    required: false,
    detect: (d) => {
      const img = get(d, "Image");
      const photo = get(d, "Photo");

      // ImageDescription is a plain ASCII string.
      const desc = getStr(img, "ImageDescription") || "";

      // UserComment has an 8-byte encoding preamble; decode properly.
      const comment = decodeUserComment(get(photo, "UserComment"));

      const markers = [
        "screenshot",
        "screen capture",
        "screencapture",
        "screen shot",
      ];
      return markers.some(
        (m) => containsWordCI(desc, m) || containsWordCI(comment, m)
      );
    },
  },
  {
    code: "software-editor",
    label: "Software / processing software tag present",
    category: "caution",
    required: false,
    detect: (d) => {
      const img = get(d, "Image");
      const photo = get(d, "Photo");
      return !!getStr(img, "Software") || !!getStr(photo, "ProcessingSoftware");
    },
  },
];

// ---------------------------------------------------------------------------
// Assessment logic
// ---------------------------------------------------------------------------

function detectSignals(
  data: ExifData
): {
  positive: Signal[];
  caution: Signal[];
  missing: string[];
} {
  const positive: Signal[] = [];
  const caution: Signal[] = [];
  const missing: string[] = [];

  for (const det of DETECTORS) {
    const hit = det.detect(data);

    if (hit) {
      if (det.category === "positive") {
        positive.push({ code: det.code, label: det.label });
      } else {
        caution.push({ code: det.code, label: det.label });
      }
    } else if (det.required) {
      missing.push(det.code);
    }
  }

  return { positive, caution, missing };
}

/**
 * Compute the review assessment from the detected signals.
 *
 * The rules are deterministic and ordered:
 *
 * 1. No signals at all, and no detectable EXIF IFD data → no-metadata
 * 2. Explicit screenshot markers → likely-screen-or-software-generated
 *    (this outweighs weak positives like orientation/resolution)
 * 3. Multiple positive categories including device identity AND optical/capture
 *    evidence → likely-camera-capture
 * 4. Only weak generic metadata (orientation, resolution, dimensions alone) →
 *    limited-evidence
 * 5. Otherwise → limited-evidence (fallback)
 */
function computeAssessment(
  positive: Signal[],
  caution: Signal[],
  _missing: string[]
): { assessment: Assessment; confidence: Confidence } {
  const hasScreenshotMarker = caution.some(
    (s) => s.code === "explicit-screenshot-marker"
  );
  const hasSoftwareEditor = caution.some((s) => s.code === "software-editor");
  const positiveCodes = new Set(positive.map((s) => s.code));

  // Strong camera evidence requires at minimum:
  // - camera-make-model OR body-serial-number (device identity)
  // - optical-settings (capture physics)
  // - capture-timestamp (chronology)
  const hasDeviceIdentity =
    positiveCodes.has("camera-make-model") ||
    positiveCodes.has("body-serial-number");
  const hasOpticalSettings = positiveCodes.has("optical-settings");
  const hasCaptureTimestamp = positiveCodes.has("capture-timestamp");

  const strongCameraEvidence =
    hasDeviceIdentity && hasOpticalSettings && hasCaptureTimestamp;

  // Explicit screenshot metadata alongside a complete, coherent camera
  // fingerprint is contradictory. Surface both sides rather than hiding one.
  if (hasScreenshotMarker && strongCameraEvidence) {
    return { assessment: "conflicting-evidence", confidence: "high" };
  }

  // Screenshot markers outweigh weak generic positives such as orientation,
  // dimensions, timestamps, and a MakerNote alone.
  if (hasScreenshotMarker) {
    return {
      assessment: "likely-screen-or-software-generated",
      confidence: "high",
    };
  }

  if (strongCameraEvidence) {
    // Strong evidence but with software tag → possibly processed camera image.
    if (hasSoftwareEditor) {
      return { assessment: "limited-evidence", confidence: "medium" };
    }
    return { assessment: "likely-camera-capture", confidence: "high" };
  }

  // Any two of the three strong categories → medium confidence.
  const mediumCount = [
    hasDeviceIdentity,
    hasOpticalSettings,
    hasCaptureTimestamp,
  ].filter(Boolean).length;
  if (mediumCount >= 2) {
    if (hasSoftwareEditor) {
      return { assessment: "limited-evidence", confidence: "medium" };
    }
    return { assessment: "likely-camera-capture", confidence: "medium" };
  }

  // Only weak generic signals (or software-only).
  return { assessment: "limited-evidence", confidence: "low" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const DISCLAIMER =
  "Metadata can be removed or modified. This is review guidance, not proof of authenticity.";

/**
 * Produce a review summary from parsed EXIF data (raw or serialized).
 *
 * Pass `null` or `undefined` when no EXIF data was found.
 *
 * The returned `ReviewResult` is always JSON-safe and deterministic.
 *
 * Classification:
 *  - null / undefined → `no-metadata`
 *  - No detectable IFD content → `no-metadata`
 *  - Weak generic EXIF (orientation, resolution, dimensions) → `limited-evidence`
 *  - Explicit screenshot markers → `likely-screen-or-software-generated`
 *  - Strong camera evidence → `likely-camera-capture`
 */
export function reviewExif(data: ExifData): ReviewResult {
  const noMetaResult = (): ReviewResult => ({
    assessment: "no-metadata",
    confidence: "low",
    positiveSignals: [],
    cautionSignals: [],
    missingSignals: DETECTORS.filter((d) => d.required).map((d) => d.code),
    disclaimer: DISCLAIMER,
  });

  if (!data || typeof data !== "object") {
    return noMetaResult();
  }

  const { positive, caution, missing } = detectSignals(data);

  // When no detectors matched, check if there is any IFD data at all.
  // An empty object or an object with only metadata keys (bigEndian etc.)
  // means no EXIF → no-metadata. Non-empty IFD groups with unrecognized
  // or weak tags → limited-evidence.
  if (positive.length === 0 && caution.length === 0) {
    if (!hasAnyIfdData(data)) {
      return noMetaResult();
    }
    return {
      assessment: "limited-evidence",
      confidence: "low",
      positiveSignals: [],
      cautionSignals: [],
      missingSignals: missing,
      disclaimer: DISCLAIMER,
    };
  }

  const { assessment, confidence } = computeAssessment(
    positive,
    caution,
    missing
  );

  return {
    assessment,
    confidence,
    positiveSignals: positive,
    cautionSignals: caution,
    missingSignals: missing,
    disclaimer: DISCLAIMER,
  };
}
