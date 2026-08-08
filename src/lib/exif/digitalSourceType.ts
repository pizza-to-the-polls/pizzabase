/**
 * Extract IPTC Digital Source Type from XMP metadata embedded in media files.
 *
 * The Digital Source Type (DST) is a controlled vocabulary from IPTC
 * (https://iptc.org/standards/photo-metadata/iptc-standard/) that
 * describes how an image was created:
 *
 *   - https://cv.iptc.org/newscodes/digitalsourcetype/
 *
 * Common values:
 *   - "originalDigitalCapture" — captured from a real scene/camera
 *   - "compositeWithSyntheticElements" — AI-generated elements mixed in
 *   - "trainedAlgorithmicMedia" — fully AI-generated
 *   - "minorHumanEdits" — minor human touch-ups
 *
 * This is parsed from the XML XMP packet embedded in JPEG APP1 or PNG
 * iTXt chunks.  We look for it in the first 64KB of the file.
 */

/**
 * Attempt to extract the IPTC Digital Source Type from a media buffer.
 * Returns the DST URI string or null if not found / not applicable.
 */
export function getDigitalSourceType(buffer: Buffer): string | null {
  try {
    // Look for XML XMP packet in the buffer.
    // XMP packets are embedded as:
    //   <x:xmpmeta xmlns:x="adobe:ns:meta/"> ... </x:xmpmeta>
    const xmlStart = findXmpBlock(buffer);
    if (!xmlStart) return null;

    // Use a simple regex to find the DigitalSourceType value without
    // a full XML parser (avoiding fast-xml-parser dependency).
    // The XMP data looks like:
    //   <Iptc4xmpCore:DigitalSourceType>https://cv.iptc.org/newscodes/digitalsourcetype/originalDigitalCapture</Iptc4xmpCore:DigitalSourceType>
    const dstRegex = new RegExp(
      `<[^>]*DigitalSourceType[^>]*>` +
        `(https:\\/\\/cv\\.iptc\\.org\\/newscodes\\/digitalsourcetype\\/[^<]+)` +
        `<\\/[^>]*DigitalSourceType>`,
      "i"
    );

    const match = dstRegex.exec(xmlStart);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Find the XMP packet block within a buffer by scanning for the
 * <x:xmpmeta ...> opening tag.  Returns the substring from that
 * point to the end of the buffer (or a reasonable chunk size).
 */
function findXmpBlock(buffer: Buffer): string | null {
  // XMP is ASCII/UTF-8 XML, so we can search as a string
  const text = buffer.toString("utf-8", 0, Math.min(buffer.length, 65536));
  const start = text.indexOf("<x:xmpmeta");

  if (start === -1) {
    // Also try the older <rdf:RDF> wrapper
    const alt = text.indexOf("<rdf:RDF");
    if (alt === -1) return null;
    return text.substring(alt, alt + 4096);
  }

  return text.substring(start, start + 4096);
}
