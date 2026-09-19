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

// ---------------------------------------------------------------------------
// Apple MOV/MP4 video fixtures (synthetic ISO BMFF with real Apple layout)
//
// Real Apple iPhone videos store EXIF in a uuid box under moov/udta:
//
//   moov → udta → uuid (85C0B687-...) → meta { hdlr, iloc, iinf }
//
// These synthetic fixtures replicate that exact layout so tests exercise the
// moov/udta/uuid code path rather than the HEIF-style top-level meta layout.
// ---------------------------------------------------------------------------

/** Apple metadata usertype UUID for the uuid box under moov/udta. */
export const APPLE_METADATA_UUID = Buffer.from([
  0x85, 0xc0, 0xb6, 0x87, 0xf4, 0x5c, 0x46, 0xda, 0x9d, 0x5d, 0x9f, 0x90, 0x49,
  0xb8, 0xe2, 0xae,
]);

/**
 * Build a minimal little-endian TIFF carrying iPhone-style EXIF: Make, Model,
 * DateTime, and a GPS IFD with latitude/longitude.
 */
export function buildIphoneTiff(): Buffer {
  const make = Buffer.from("Apple\0", "ascii"); // 6 bytes
  const model = Buffer.from("iPhone 14 Pro\0", "ascii"); // 14 bytes
  const dateTime = Buffer.from("2024:01:15 10:30:00\0", "ascii"); // 20 bytes
  const gpsRef = Buffer.from("N\0", "ascii"); // 2 bytes
  const gpsLonRef = Buffer.from("W\0", "ascii"); // 2 bytes

  const gpsLat = Buffer.alloc(24);
  gpsLat.writeUInt32LE(34, 0);
  gpsLat.writeUInt32LE(1, 4);
  gpsLat.writeUInt32LE(3, 8);
  gpsLat.writeUInt32LE(1, 12);
  gpsLat.writeUInt32LE(0, 16);
  gpsLat.writeUInt32LE(1, 20);

  const gpsLon = Buffer.alloc(24);
  gpsLon.writeUInt32LE(118, 0);
  gpsLon.writeUInt32LE(1, 4);
  gpsLon.writeUInt32LE(14, 8);
  gpsLon.writeUInt32LE(1, 12);
  gpsLon.writeUInt32LE(0, 16);
  gpsLon.writeUInt32LE(1, 20);

  const ifd0Start = 8;
  const ifd0Next = ifd0Start + 2 + 3 * 12 + 4;
  const gpsIfdStart = ifd0Next;
  const gpsIfdEnd = gpsIfdStart + 2 + 4 * 12 + 4;
  let extra = gpsIfdEnd;

  const extraMake = extra;
  extra += make.length;
  const extraModel = extra;
  extra += model.length;
  const extraDateTime = extra;
  extra += dateTime.length;
  const extraGpsLat = extra;
  extra += gpsLat.length;
  const extraGpsLon = extra;
  extra += gpsLon.length;

  const buf = Buffer.alloc(extra);
  buf.write("II", 0, "ascii");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifd0Start, 4);

  // IFD0: Make, Model, GPSInfo pointer.
  buf.writeUInt16LE(3, ifd0Start);
  let off = ifd0Start + 2;
  buf.writeUInt16LE(0x010f, off);
  buf.writeUInt16LE(2, off + 2);
  buf.writeUInt32LE(make.length, off + 4);
  buf.writeUInt32LE(extraMake, off + 8);
  off += 12;
  buf.writeUInt16LE(0x0110, off);
  buf.writeUInt16LE(2, off + 2);
  buf.writeUInt32LE(model.length, off + 4);
  buf.writeUInt32LE(extraModel, off + 8);
  off += 12;
  buf.writeUInt16LE(0x8825, off);
  buf.writeUInt16LE(4, off + 2);
  buf.writeUInt32LE(1, off + 4);
  buf.writeUInt32LE(gpsIfdStart, off + 8);
  off += 12;
  buf.writeUInt32LE(0, off);

  // GPS IFD: lat ref, lat, lon ref, lon.
  buf.writeUInt16LE(4, gpsIfdStart);
  off = gpsIfdStart + 2;
  buf.writeUInt16LE(0x0001, off);
  buf.writeUInt16LE(2, off + 2);
  buf.writeUInt32LE(2, off + 4);
  gpsRef.copy(buf, off + 8);
  off += 12;
  buf.writeUInt16LE(0x0002, off);
  buf.writeUInt16LE(5, off + 2);
  buf.writeUInt32LE(3, off + 4);
  buf.writeUInt32LE(extraGpsLat, off + 8);
  off += 12;
  buf.writeUInt16LE(0x0003, off);
  buf.writeUInt16LE(2, off + 2);
  buf.writeUInt32LE(2, off + 4);
  gpsLonRef.copy(buf, off + 8);
  off += 12;
  buf.writeUInt16LE(0x0004, off);
  buf.writeUInt16LE(5, off + 2);
  buf.writeUInt32LE(3, off + 4);
  buf.writeUInt32LE(extraGpsLon, off + 8);
  off += 12;
  buf.writeUInt32LE(0, off);

  make.copy(buf, extraMake);
  model.copy(buf, extraModel);
  dateTime.copy(buf, extraDateTime);
  gpsLat.copy(buf, extraGpsLat);
  gpsLon.copy(buf, extraGpsLon);

  return buf;
}

/**
 * Build a synthetic Apple MOV/MP4 with the real video EXIF layout.
 *
 * When `nonFaststart` is false, the file is ftyp → moov(udta/uuid/meta) →
 * mdat(exif), and the iloc points at the TIFF inside mdat.
 *
 * When `nonFaststart` is true, the file is ftyp → mdat(padding) → moov with
 * the EXIF stored inline after the meta box inside the uuid (so a bounded tail
 * read finds it). The mdat padding pushes moov past 256 KiB.
 */
export function buildAppleVideo(
  exifTiff: Buffer,
  brand: string,
  opts: { nonFaststart?: boolean } = {},
): { buffer: Buffer; moovStart: number } {
  const nonFaststart = !!opts.nonFaststart;

  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftyp", 4, 4, "ascii");
  ftyp.write(brand, 8, 4, "ascii");
  ftyp.writeUInt32BE(0, 12);
  ftyp.write("isom", 16, 4, "ascii");

  const hdlr = Buffer.alloc(33);
  hdlr.writeUInt32BE(33, 0);
  hdlr.write("hdlr", 4, 4, "ascii");
  hdlr.writeUInt32BE(0, 8);
  hdlr.writeUInt32BE(0, 12);
  hdlr.write("pict", 16, 4, "ascii");
  hdlr.writeUInt32BE(0, 20);
  hdlr.writeUInt32BE(0, 24);
  hdlr.writeUInt32BE(0, 28);
  hdlr[32] = 0;

  const iloc = Buffer.alloc(30);
  iloc.writeUInt32BE(30, 0);
  iloc.write("iloc", 4, 4, "ascii");
  iloc.writeUInt32BE(0, 8);
  iloc[12] = 0x44;
  iloc[13] = 0x00;
  iloc.writeUInt16BE(1, 14);
  iloc.writeUInt16BE(1, 16);
  iloc.writeUInt16BE(0, 18);
  iloc.writeUInt16BE(1, 20);
  iloc.writeUInt32BE(exifTiff.length, 26);

  const infe = Buffer.alloc(27);
  infe.writeUInt32BE(27, 0);
  infe.write("infe", 4, 4, "ascii");
  infe.writeUInt32BE(0x02000000, 8);
  infe.writeUInt32BE(1, 12);
  infe.writeUInt16BE(0, 16);
  infe.write("Exif", 18, 4, "ascii");
  infe.write("Exif\0", 22, 5, "ascii");

  const iinf = Buffer.alloc(41);
  iinf.writeUInt32BE(41, 0);
  iinf.write("iinf", 4, 4, "ascii");
  iinf.writeUInt32BE(0, 8);
  iinf.writeUInt16BE(1, 12);
  infe.copy(iinf, 14);

  const meta = Buffer.alloc(116);
  meta.writeUInt32BE(116, 0);
  meta.write("meta", 4, 4, "ascii");
  meta.writeUInt32BE(0, 8);
  hdlr.copy(meta, 12);
  iloc.copy(meta, 45);
  iinf.copy(meta, 75);

  const uuidPayload = nonFaststart ? Buffer.concat([meta, exifTiff]) : meta;
  const uuid = Buffer.alloc(24 + uuidPayload.length);
  uuid.writeUInt32BE(uuid.length, 0);
  uuid.write("uuid", 4, 4, "ascii");
  APPLE_METADATA_UUID.copy(uuid, 8);
  uuidPayload.copy(uuid, 24);

  const udta = Buffer.alloc(8 + uuid.length);
  udta.writeUInt32BE(udta.length, 0);
  udta.write("udta", 4, 4, "ascii");
  uuid.copy(udta, 8);

  const moov = Buffer.alloc(8 + udta.length);
  moov.writeUInt32BE(moov.length, 0);
  moov.write("moov", 4, 4, "ascii");
  udta.copy(moov, 8);

  let mdat: Buffer;
  if (nonFaststart) {
    // Pad mdat so moov lands after 256 KiB.
    mdat = Buffer.alloc(8 + 256 * 1024);
    mdat.writeUInt32BE(mdat.length, 0);
    mdat.write("mdat", 4, 4, "ascii");
  } else {
    mdat = Buffer.alloc(8 + exifTiff.length);
    mdat.writeUInt32BE(mdat.length, 0);
    mdat.write("mdat", 4, 4, "ascii");
    exifTiff.copy(mdat, 8);
  }

  const buffer = nonFaststart
    ? Buffer.concat([ftyp, mdat, moov])
    : Buffer.concat([ftyp, moov, mdat]);

  const moovStart = ftyp.length + (nonFaststart ? mdat.length : 0);

  // iloc starts at moovStart + moovHdr(8) + udtaHdr(8) + uuidHdr(24)
  //                + metaFullHdr(12) + hdlr(33)
  //              = moovStart + 109
  // Patch dynamically: the iloc extent must point at the EXIF payload's
  // absolute file offset (deep past the mdat padding for non-faststart).
  // Field layout from the iloc TYPE position: extent offset at +18,
  // extent length at +22.
  const ilocPos = buffer.indexOf(Buffer.from("iloc", "ascii"));
  const exifPos = buffer.indexOf(exifTiff);
  buffer.writeUInt32BE(exifPos, ilocPos + 18);
  buffer.writeUInt32BE(exifTiff.length, ilocPos + 22);

  return { buffer, moovStart };
}

/**
 * Synthetic faststart iPhone MOV (qt brand) carrying Make/Model/GPS EXIF via
 * the Apple moov/udta/uuid layout.
 */
export const iphoneVideoMov: Buffer = buildAppleVideo(
  buildIphoneTiff(),
  "qt  ",
).buffer;

/**
 * Synthetic non-faststart MP4 whose moov sits after 256 KiB of mdat, with the
 * EXIF stored inline in the uuid box — exercises the bounded tail read.
 */
export const nonFaststartMp4: Buffer = buildAppleVideo(
  buildIphoneTiff(),
  "mp42",
  { nonFaststart: true },
).buffer;

// ---------------------------------------------------------------------------
// Real-device-layout iPhone MOV
//
// A genuine device sample cannot be checked in (privacy + size constraints),
// so this builder replicates byte-for-byte the box hierarchy a real iPhone
// MOV exhibits after being trimmed to its front-of-file boxes:
//
//   ftyp (major brand "qt  ", minor 0x00000200)
//   free
//   moov
//     mvhd (movie header, v0, 108 bytes)
//     trak
//       tkhd (track header, v0, 1920×1080)
//       mdia
//         mdhd (media header, v0, 600 timescale)
//         hdlr (handler type "vide")
//         minf
//           vmhd, dinf(dref(url)), stbl(stsd(avc1), stts, stsc, stsz, stco)
//     udta
//       uuid (85C0B687-...) → meta { hdlr, iloc, iinf(Exif item) }
//   wide (QuickTime mdat padding)
//   mdat (TIFF EXIF payload referenced by iloc)
//
// Unlike the minimal fixtures above, this forces the parser to skip genuine
// sibling boxes (mvhd / trak / mdia / ...) before reaching udta, matching the
// walk a real iPhone video requires.
// ---------------------------------------------------------------------------

function uint32Buf(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0, 0);
  return b;
}

function uint16Buf(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v & 0xffff, 0);
  return b;
}

/** Assemble a BMFF box from payload pieces; sizes are computed, not hard-coded. */
function box(type: string, ...payloads: Buffer[]): Buffer {
  const size = 8 + payloads.reduce((n, p) => n + p.length, 0);
  const b = Buffer.alloc(size);
  b.writeUInt32BE(size, 0);
  b.write(type, 4, 4, "ascii");
  let off = 8;
  for (const p of payloads) {
    p.copy(b, off);
    off += p.length;
  }
  return b;
}

/** Assemble a full box (version/flags after the header) from payload pieces. */
function fullBox(
  type: string,
  versionAndFlags: number,
  ...payloads: Buffer[]
): Buffer {
  return box(type, uint32Buf(versionAndFlags), ...payloads);
}

/** Identity matrix as stored in mvhd/tkhd (36 bytes). */
function unityMatrix36(): Buffer {
  const m = Buffer.alloc(36);
  m.writeUInt32BE(0x00010000, 0);
  m.writeUInt32BE(0x00010000, 16);
  m.writeUInt32BE(0x40000000, 32);
  return m;
}

/**
 * Build an iPhone-structured MOV: real device box hierarchy with the EXIF
 * TIFF referenced by the Apple metadata uuid MetaBox and stored in mdat.
 */
export function buildIphoneRealLayoutVideo(exifTiff: Buffer): {
  buffer: Buffer;
  mdatDataStart: number;
} {
  const CREATION_TIME = 0x26a2e6c0; // arbitrary real-looking timestamp
  const MOVIE_TIMESCALE = 600;
  const DURATION = 180; // 0.3 s of video

  const ftyp = box(
    "ftyp",
    Buffer.concat([
      Buffer.from("qt  ", "ascii"), // major brand
      uint32Buf(0x00000200), // minor version
      Buffer.from("qt  ", "ascii"), // compatible brand
    ]),
  );

  const free = box("free");

  // ---- moov / mvhd ------------------------------------------------------
  const mvhdPayload = Buffer.alloc(100);
  mvhdPayload.writeUInt32BE(CREATION_TIME, 0); // creation time
  mvhdPayload.writeUInt32BE(CREATION_TIME, 4); // modification time
  mvhdPayload.writeUInt32BE(MOVIE_TIMESCALE, 8);
  mvhdPayload.writeUInt32BE(DURATION, 12);
  mvhdPayload.writeUInt32BE(0x00010000, 16); // rate 1.0
  mvhdPayload.writeUInt16BE(0x0100, 20); // volume 1.0
  // 22–35: reserved
  unityMatrix36().copy(mvhdPayload, 36);
  // 72–95: pre-defined
  mvhdPayload.writeUInt32BE(2, 96); // nextTrackID
  const mvhd = box("mvhd", mvhdPayload);

  // ---- moov / trak ------------------------------------------------------
  const tkhdPayload = Buffer.alloc(84);
  tkhdPayload.writeUInt32BE(0x00000007, 0); // flags: enabled | in movie | in preview
  tkhdPayload.writeUInt32BE(CREATION_TIME, 4);
  tkhdPayload.writeUInt32BE(CREATION_TIME, 8);
  tkhdPayload.writeUInt32BE(1, 12); // track ID
  // 16–19: reserved
  tkhdPayload.writeUInt32BE(DURATION, 20);
  // 24–31: reserved
  // 32: layer, 34: alternate group, 36: volume, 38: reserved (all zero)
  unityMatrix36().copy(tkhdPayload, 40);
  tkhdPayload.writeUInt32BE(1920 << 16, 76); // width (16.16 fixed)
  tkhdPayload.writeUInt32BE(1080 << 16, 80); // height (16.16 fixed)
  const tkhd = fullBox("tkhd", 0, tkhdPayload);

  const mdhdPayload = Buffer.alloc(24);
  mdhdPayload.writeUInt32BE(CREATION_TIME, 0);
  mdhdPayload.writeUInt32BE(CREATION_TIME, 4);
  mdhdPayload.writeUInt32BE(MOVIE_TIMESCALE, 8);
  mdhdPayload.writeUInt32BE(DURATION, 12);
  mdhdPayload.writeUInt16BE(0x55c4, 16); // language "und"
  const mdhd = fullBox("mdhd", 0, mdhdPayload);

  const mediaHdlr = fullBox(
    "hdlr",
    0,
    Buffer.concat([
      uint32Buf(0), // pre-defined
      Buffer.from("vide", "ascii"),
      Buffer.alloc(12), // reserved
      Buffer.from([0]), // null-terminated name
    ]),
  );

  const vmhd = fullBox(
    "vmhd",
    1,
    Buffer.concat([uint16Buf(0), Buffer.alloc(6)]), // graphicsmode + opcolor
  );

  const dref = fullBox("dref", 0, uint32Buf(1), fullBox("url ", 1));

  const avc1 = Buffer.alloc(16); // minimal sample entry
  avc1.write("avc1", 4, 4, "ascii");
  // 8–13: reserved
  avc1.writeUInt16BE(1, 14); // data reference index
  const stbl = box(
    "stbl",
    fullBox("stsd", 0, uint32Buf(1), avc1),
    fullBox("stts", 0, uint32Buf(0)),
    fullBox("stsc", 0, uint32Buf(0)),
    fullBox("stsz", 0, uint32Buf(0), uint32Buf(0)),
    fullBox("stco", 0, uint32Buf(0)),
  );

  const minf = box("minf", vmhd, box("dinf", dref), stbl);
  const mdia = box("mdia", mdhd, mediaHdlr, minf);
  const trak = box("trak", tkhd, mdia);

  // ---- moov / udta → uuid → meta (Apple EXIF metadata) ------------------
  const appleMetaHdlr = fullBox(
    "hdlr",
    0,
    Buffer.concat([
      uint32Buf(0), // pre-defined
      Buffer.from("pict", "ascii"),
      Buffer.alloc(12), // reserved
      Buffer.from([0]), // name
    ]),
  );

  const iloc = fullBox(
    "iloc",
    0, // version 0
    Buffer.from([0x44, 0x00]), // offsetSize=4, lengthSize=4, baseOffsetSize=0
    uint16Buf(1), // item count
    uint16Buf(1), // item_ID
    uint16Buf(0), // data reference index
    uint16Buf(1), // extent count
    uint32Buf(0), // extent offset — patched after assembly
    uint32Buf(exifTiff.length), // extent length
  );

  const infe = fullBox(
    "infe",
    0x02000000, // version 2
    uint32Buf(1), // item ID
    uint16Buf(0), // item protection index
    Buffer.from("Exif", "ascii"), // item type
    Buffer.from("Exif\0", "ascii"), // item name
  );

  const iinf = fullBox("iinf", 0, uint16Buf(1), infe);
  const meta = fullBox("meta", 0, appleMetaHdlr, iloc, iinf);
  const uuidBox = box("uuid", APPLE_METADATA_UUID, meta);
  const udta = box("udta", uuidBox);

  const moov = box("moov", mvhd, trak, udta);

  const wide = box("wide");
  const mdat = box("mdat", exifTiff);

  const buffer = Buffer.concat([ftyp, free, moov, wide, mdat]);

  // Patch the iloc extent offset to the absolute file offset of the TIFF
  // payload inside mdat. Field layout from the iloc TYPE position:
  //   type(4) ver/flags(4) sizes(2) itemCount(2) itemID(2) dataRefIndex(2)
  //   extentCount(2) → extent OFFSET at +18, extent LENGTH at +22.
  // Locate the iloc box dynamically rather than by hand-computed offsets
  // so the structure can evolve safely.
  const ilocPos = buffer.indexOf(Buffer.from("iloc", "ascii"));
  const mdatDataStart =
    ftyp.length + free.length + moov.length + wide.length + 8;
  buffer.writeUInt32BE(mdatDataStart, ilocPos + 18);

  return { buffer, mdatDataStart };
}

/**
 * Real-device-layout iPhone MOV (faststart: ftyp+free+moov+wide+mdat) with
 * genuine Apple-style EXIF (Make/Model/DateTime/GPS) in moov/udta/uuid.
 */
export const iphoneRealLayoutMov: Buffer =
  buildIphoneRealLayoutVideo(buildIphoneTiff()).buffer;
