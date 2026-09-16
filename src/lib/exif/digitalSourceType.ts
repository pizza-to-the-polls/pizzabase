/**
 * Parse IPTC Digital Source Type from XMP metadata.
 *
 * The IPTC Digital Source Type field (namespace
 * `http://iptc.org/std/Iptc4xmpExt/2008-02-29/`) provides a structured signal
 * about image provenance. It uses controlled-vocabulary URIs from
 * `http://cv.iptc.org/newscodes/digitalsourcetype/`.
 *
 * XMP XML is typically embedded in:
 *   - JPEG APP1 segments with signature "http://ns.adobe.com/xap/1.0/"
 *   - PNG iTXt chunks with keyword "XML:com.adobe.xmp"
 *   - Standalone .xmp sidecar files
 *
 * Reference: https://www.iptc.org/std/photometadata/documentation/userguide/#_digital_source_type
 */

import { XMLParser } from "fast-xml-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DigitalSourceTypeResult {
  /** The full IPTC controlled-vocabulary URI, or null if not found. */
  uri: string | null;
  /** Human-readable label derived from the URI, or null if not found. */
  label: string | null;
}

// ---------------------------------------------------------------------------
// URI → label mapping
// ---------------------------------------------------------------------------

/**
 * Full controlled-vocabulary URI → human-readable label.
 *
 * Covers the IPTC NewsCodes for Digital Source Type as of the
 * IPTC Photo Metadata Standard 2024.1.
 */
export const DIGITAL_SOURCE_TYPE_LABELS: Record<string, string> = {
  "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture":
    "digital capture",
  "http://cv.iptc.org/newscodes/digitalsourcetype/negativeFilm":
    "negative film",
  "http://cv.iptc.org/newscodes/digitalsourcetype/positiveFilm":
    "positive film",
  "http://cv.iptc.org/newscodes/digitalsourcetype/scannedImage":
    "scanned image",
  "http://cv.iptc.org/newscodes/digitalsourcetype/screenCapture":
    "screen capture",
  "http://cv.iptc.org/newscodes/digitalsourcetype/screenRecording":
    "screen recording",
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia":
    "AI-generated media",
  "http://cv.iptc.org/newscodes/digitalsourcetype/compositeSynthetic":
    "composite / synthetic",
  "http://cv.iptc.org/newscodes/digitalsourcetype/composite": "composite",
  "http://cv.iptc.org/newscodes/digitalsourcetype/virtualRecording":
    "virtual recording",
  "http://cv.iptc.org/newscodes/digitalsourcetype/dataDrivenMedia":
    "data-driven media",
};

// ---------------------------------------------------------------------------
// XML parser configuration
// ---------------------------------------------------------------------------

/**
 * Create a configured XMLParser instance.
 *
 * Safety settings:
 *   - processEntities: false – prevent XXE expansion
 *   - ignoreAttributes: false – need attribute parsing for rdf:resource
 *   - allowBooleanAttributes: false – avoid unexpected bool nodes
 */
function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
    allowBooleanAttributes: false,
    removeNSPrefix: false,
    isArray: (
      _name: string,
      jpath: string,
      _isLeafNode: boolean,
      _isAttribute: boolean,
    ) => {
      // rdf:Description can appear multiple times; ensure it's always an array
      return jpath.endsWith(".rdf:Description");
    },
  });
}

// ---------------------------------------------------------------------------
// Extraction logic
// ---------------------------------------------------------------------------

/**
 * Search a parsed XMP object tree for a DigitalSourceType value.
 *
 * Walks the parsed XML structure looking for element nodes whose local
 * name or qualified name matches "DigitalSourceType" within the
 * Iptc4xmpExt namespace.
 *
 * Handles two common XMP representations:
 *   1. Element text content:
 *      <Iptc4xmpExt:DigitalSourceType>
 *        http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture
 *      </Iptc4xmpExt:DigitalSourceType>
 *
 *   2. rdf:resource attribute:
 *      <Iptc4xmpExt:DigitalSourceType
 *        rdf:resource="http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"/>
 */
function findDigitalSourceTypeValue(
  node: unknown,
  path: string,
): string | null {
  if (node === null || node === undefined) return null;

  if (typeof node === "string") {
    return null;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const result = findDigitalSourceTypeValue(item, path);
      if (result !== null) return result;
    }
    return null;
  }

  if (typeof node === "object") {
    const record = node as Record<string, unknown>;

    // Check if this node itself matches DigitalSourceType.
    // fast-xml-parser produces keys like "Iptc4xmpExt:DigitalSourceType".
    for (const key of Object.keys(record)) {
      // Match any prefix with local name "DigitalSourceType" (e.g.,
      // "Iptc4xmpExt:DigitalSourceType" or simply "DigitalSourceType"
      // if the parser stripped namespaces).
      const isDirectMatch =
        key === "DigitalSourceType" || key.endsWith(":DigitalSourceType");

      if (isDirectMatch) {
        const val = record[key];
        // Case 1: element text content – value itself is a string (the URI).
        if (typeof val === "string" && val.trim().length > 0) {
          return val.trim();
        }
        // Case 2: rdf:resource attribute on the element.
        if (val !== null && typeof val === "object") {
          const attrs = val as Record<string, unknown>;
          if (
            "@_rdf:resource" in attrs &&
            typeof attrs["@_rdf:resource"] === "string"
          ) {
            return attrs["@_rdf:resource"] as string;
          }
        }
      }
    }

    // Recurse into child elements.
    for (const key of Object.keys(record)) {
      const val = record[key];
      if (typeof val === "object" && val !== null) {
        const result = findDigitalSourceTypeValue(val, `${path}.${key}`);
        if (result !== null) return result;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse IPTC Digital Source Type from an XMP XML string.
 *
 * Returns `{ uri, label }` where `uri` is the IPTC controlled-vocabulary URI
 * and `label` is a human-readable description. Both are `null` when no
 * DigitalSourceType field is found in the XMP.
 *
 * This function is defensive:
 *   - XML parse failures return `{ uri: null, label: null }` – never throw.
 *   - Empty or non-XMP strings are handled gracefully.
 *   - If a URI is found but not in the label map, the label is the URI itself.
 *
 * @param xmpXml - Raw XMP XML string (e.g. from JPEG APP1 or PNG iTXt).
 */
export function parseDigitalSourceType(
  xmpXml: string,
): DigitalSourceTypeResult {
  if (!xmpXml || typeof xmpXml !== "string" || xmpXml.trim().length === 0) {
    return { uri: null, label: null };
  }

  let parsed: unknown;
  try {
    const parser = createParser();
    parsed = parser.parse(xmpXml);
  } catch {
    return { uri: null, label: null };
  }

  if (!parsed || typeof parsed !== "object") {
    return { uri: null, label: null };
  }

  const uri = findDigitalSourceTypeValue(parsed, "");

  if (!uri) {
    return { uri: null, label: null };
  }

  const label = DIGITAL_SOURCE_TYPE_LABELS[uri] ?? uri;

  return { uri, label };
}
