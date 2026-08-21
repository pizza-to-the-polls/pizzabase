/**
 * Binary test fixtures for EXIF extraction and review tests.
 *
 * The checked-in files under ./exif/ are metadata-preserving derivatives of
 * the supplied production-style examples. JPEG derivatives contain the real
 * container header and APP1 EXIF segment; the PNG derivative contains the real
 * IHDR and IEND chunks and intentionally has no eXIf chunk.
 */

import * as fs from "fs";
import * as path from "path";

const DERIVED_FIXTURE_DIR = path.join(__dirname, "exif");

function readDerivedFixture(name: string): Buffer {
  return fs.readFileSync(path.join(DERIVED_FIXTURE_DIR, name));
}

// ---------------------------------------------------------------------------
// Synthetic helpers for malformed / edge cases only
// ---------------------------------------------------------------------------

function fromHex(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

// ---------------------------------------------------------------------------
// Exported fixtures
// ---------------------------------------------------------------------------

/**
 * Brooklyn JPEG fixture (sparse real EXIF: orientation, resolution, dimensions).
 *
 */
export const brooklynJpeg: Buffer = readDerivedFixture("brooklyn-exif.jpeg");

/**
 * Redondo Beach JPEG fixture (screenshot markers in EXIF).
 */
export const redondoJpeg: Buffer = readDerivedFixture(
  "redondo-screenshot-exif.jpeg",
);

/**
 * Los Angeles PNG fixture (no EXIF).
 */
export const losAngelesPng: Buffer = readDerivedFixture(
  "los-angeles-no-exif.png",
);

// ---------------------------------------------------------------------------
// Malformed / edge-case fixtures (always synthetic – no production equivalent)
// ---------------------------------------------------------------------------

/**
 * JPEG with APP1 marker whose declared length extends beyond the buffer.
 * Tests safe bounds handling in the parser.
 */
export const truncatedJpeg: Buffer = (() => {
  return Buffer.concat([
    fromHex("FFD8"), // SOI
    fromHex("FFE1"), // APP1
    fromHex("1000"), // Length = 4096 (much more than available)
    fromHex("457869660000"), // "Exif\0\0"
  ]);
})();

/**
 * Minimal JPEG with a JFIF APP0 segment but no EXIF APP1.
 */
export const jpegNoExif: Buffer = (() => {
  return Buffer.concat([
    fromHex("FFD8"),
    fromHex(
      "FFE0" + // APP0 marker
        "0010" + // Length = 16
        "4A46494600" + // "JFIF\0"
        "0102" + // Version 1.2
        "00" + // Units = none
        "0001" + // X density
        "0001" + // Y density
        "00" + // No thumbnail
        "00", // No thumbnail
    ),
    fromHex("FFD9"),
  ]);
})();

/**
 * JPEG with APP1 "Exif\0\0" signature followed by only 4 bytes of TIFF.
 * exif-reader should throw on the incomplete TIFF; the controller catches it.
 */
export const jpegTruncatedExif: Buffer = (() => {
  const soi = fromHex("FFD8");
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(12, 0); // 2 (len field) + 6 (sig) + 4 (partial TIFF)
  const app1 = Buffer.concat([
    fromHex("FFE1"),
    lenBuf,
    Buffer.from("Exif\0\0", "ascii"),
    fromHex("49492A00"), // "II*" + partial offset
  ]);
  return Buffer.concat([soi, app1, fromHex("FFD9")]);
})();
