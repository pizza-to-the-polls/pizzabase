import { reviewExif, DISCLAIMER } from "./review";
import type { ExifData } from "./review";

describe("reviewExif", () => {
  it("returns no-metadata for null / undefined", () => {
    const result = reviewExif(null);
    expect(result.assessment).toBe("no-metadata");
    expect(result.confidence).toBe("low");
    expect(result.positiveSignals).toEqual([]);
    expect(result.cautionSignals).toEqual([]);
    expect(result.missingSignals).toContain("camera-make-model");
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  it("returns no-metadata for empty object", () => {
    const result = reviewExif({});
    expect(result.assessment).toBe("no-metadata");
    expect(result.confidence).toBe("low");
  });

  it("returns no-metadata for object with only non-IFD keys", () => {
    // exif-reader sometimes returns { bigEndian: true, hasThumbnail: false }
    const result = reviewExif({ bigEndian: true, hasThumbnail: false });
    expect(result.assessment).toBe("no-metadata");
  });

  // -----------------------------------------------------------------------
  // Sparse generic EXIF (Brooklyn-style: orientation, resolution, dimensions
  // but no make/model, optical settings, or timestamp)
  // -----------------------------------------------------------------------

  it("classifies sparse generic EXIF as limited-evidence", () => {
    const data: ExifData = {
      Image: {
        Orientation: 1,
        XResolution: 216,
        YResolution: 216,
        ResolutionUnit: 2,
      },
      Photo: {
        PixelXDimension: 1206,
        PixelYDimension: 1562,
        ColorSpace: 1,
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("limited-evidence");
    expect(result.confidence).toBe("low");

    const positiveCodes = result.positiveSignals.map((s) => s.code);
    expect(positiveCodes).toContain("exif-dimensions");

    expect(result.missingSignals).toContain("camera-make-model");
    expect(result.missingSignals).toContain("optical-settings");
    expect(result.missingSignals).toContain("capture-timestamp");
  });

  // -----------------------------------------------------------------------
  // Screenshot markers (Redondo Beach style)
  // -----------------------------------------------------------------------

  it("detects screenshot markers and overrides weak positives", () => {
    const data: ExifData = {
      Image: {
        ImageDescription: "Screenshot",
        Orientation: 1,
        XResolution: 72,
        YResolution: 72,
      },
      Photo: {
        PixelXDimension: 435,
        UserComment: Buffer.from("Screenshot"),
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("likely-screen-or-software-generated");
    expect(result.confidence).toBe("high");

    const cautionCodes = result.cautionSignals.map((s) => s.code);
    expect(cautionCodes).toContain("explicit-screenshot-marker");
  });

  it("detects 'screen capture' as screenshot marker", () => {
    const data: ExifData = {
      Image: {
        ImageDescription: "Screen Capture of desktop",
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("likely-screen-or-software-generated");
    expect(
      result.cautionSignals.some((s) => s.code === "explicit-screenshot-marker")
    ).toBe(true);
  });

  it("detects 'screencapture' as screenshot marker", () => {
    const data: ExifData = {
      Photo: {
        UserComment: Buffer.from("screencapture_2024-01-01"),
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("likely-screen-or-software-generated");
  });

  it("detects screenshot markers from serialized {_bytes} UserComment", () => {
    const data: ExifData = {
      Photo: {
        UserComment: {
          _bytes: Buffer.from("Screenshot").toString("base64"),
        },
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("likely-screen-or-software-generated");
    expect(
      result.cautionSignals.some((s) => s.code === "explicit-screenshot-marker")
    ).toBe(true);
  });

  it("correctly decodes UserComment with ASCII encoding preamble", () => {
    const preamble = Buffer.from("ASCII\0\0\0");
    const body = Buffer.from("Screenshot", "ascii");
    const userComment = Buffer.concat([preamble, body]);

    const data: ExifData = {
      Photo: {
        UserComment: userComment,
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("likely-screen-or-software-generated");
    expect(
      result.cautionSignals.some((s) => s.code === "explicit-screenshot-marker")
    ).toBe(true);
  });

  it("correctly decodes UserComment with UNICODE encoding preamble", () => {
    const preamble = Buffer.from("UNICODE\0");
    // "Screenshot" in UTF-16LE
    const body = Buffer.from("S\0c\0r\0e\0e\0n\0s\0h\0o\0t\0", "utf-16le");
    const userComment = Buffer.concat([preamble, body]);

    const data: ExifData = {
      Photo: {
        UserComment: userComment,
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("likely-screen-or-software-generated");
  });

  it("handles UserComment with undefined encoding (8 null bytes)", () => {
    const preamble = Buffer.alloc(8, 0);
    const body = Buffer.from("some data", "ascii");
    const userComment = Buffer.concat([preamble, body]);

    const data: ExifData = {
      Photo: {
        UserComment: userComment,
      },
    };

    // No screenshot markers → limited-evidence
    const result = reviewExif(data);
    expect(result.assessment).toBe("limited-evidence");
  });

  it("handles short UserComment (<= 8 bytes) gracefully", () => {
    const data: ExifData = {
      Photo: {
        UserComment: Buffer.from("short"),
      },
    };

    // No screenshot marker → limited-evidence
    const result = reviewExif(data);
    expect(result.assessment).toBe("limited-evidence");
  });

  // -----------------------------------------------------------------------
  // Strong camera evidence (device identity + optical + timestamp)
  // -----------------------------------------------------------------------

  it("classifies strong camera evidence as likely-camera-capture", () => {
    const data: ExifData = {
      Image: {
        Make: "Canon",
        Model: "EOS R5",
        Orientation: 1,
        DateTime: new Date("2024-01-15T12:00:00Z"),
      },
      Photo: {
        ExposureTime: 0.004,
        FNumber: 5.6,
        ISOSpeedRatings: 400,
        FocalLength: 50,
        DateTimeOriginal: new Date("2024-01-15T12:00:00Z"),
        PixelXDimension: 8192,
        PixelYDimension: 5464,
        BodySerialNumber: "12345678",
        LensMake: "Canon",
        LensModel: "EF 50mm f/1.8",
        MakerNote: Buffer.from("canon_maker_note_data"),
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("likely-camera-capture");
    expect(result.confidence).toBe("high");

    const positiveCodes = result.positiveSignals.map((s) => s.code);
    expect(positiveCodes).toContain("camera-make-model");
    expect(positiveCodes).toContain("optical-settings");
    expect(positiveCodes).toContain("capture-timestamp");
    expect(positiveCodes).toContain("body-serial-number");
    expect(positiveCodes).toContain("lens-info");
    expect(positiveCodes).toContain("maker-note");
  });

  it("surfaces conflicting evidence instead of hiding either side", () => {
    const data: ExifData = {
      Image: {
        Make: "Example Camera",
        Model: "Model 1",
        ImageDescription: "Screenshot",
      },
      Photo: {
        ExposureTime: 0.01,
        FNumber: 2.8,
        DateTimeOriginal: new Date("2024-03-01T10:00:00Z"),
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("conflicting-evidence");
    expect(result.confidence).toBe("high");
    expect(result.positiveSignals.map((signal) => signal.code)).toEqual(
      expect.arrayContaining([
        "camera-make-model",
        "optical-settings",
        "capture-timestamp",
      ])
    );
    expect(result.cautionSignals.map((signal) => signal.code)).toContain(
      "explicit-screenshot-marker"
    );
  });

  // -----------------------------------------------------------------------
  // Camera evidence + software tag = processed camera image
  // -----------------------------------------------------------------------

  it("demotes strong camera evidence with software tag to limited-evidence", () => {
    const data: ExifData = {
      Image: {
        Make: "Sony",
        Model: "A7IV",
        DateTime: new Date("2024-03-01T10:00:00Z"),
        Software: "Adobe Lightroom 7.0",
      },
      Photo: {
        ExposureTime: 0.01,
        FNumber: 2.8,
        FocalLength: 35,
        DateTimeOriginal: new Date("2024-03-01T10:00:00Z"),
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("limited-evidence");
    expect(result.confidence).toBe("medium");
    expect(
      result.cautionSignals.some((s) => s.code === "software-editor")
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Two of three strong signals = medium confidence camera capture
  // -----------------------------------------------------------------------

  it("classifies two-of-three strong signals as medium-confidence camera capture", () => {
    const data: ExifData = {
      Image: {
        Make: "Nikon",
        Model: "Z6",
      },
      Photo: {
        ExposureTime: 0.001,
        FNumber: 4,
        LensModel: "24-70mm f/4",
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("likely-camera-capture");
    expect(result.confidence).toBe("medium");

    expect(result.missingSignals).toContain("capture-timestamp");
    expect(
      result.positiveSignals.some((s) => s.code === "camera-make-model")
    ).toBe(true);
    expect(
      result.positiveSignals.some((s) => s.code === "optical-settings")
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Orientation alone → limited evidence (not no-metadata)
  // -----------------------------------------------------------------------

  it("classifies orientation-only EXIF as limited-evidence", () => {
    const data: ExifData = {
      Image: {
        Orientation: 1,
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("limited-evidence");
    expect(result.confidence).toBe("low");
    expect(result.missingSignals).toContain("camera-make-model");
    expect(result.missingSignals).toContain("optical-settings");
    expect(result.missingSignals).toContain("capture-timestamp");
  });

  // -----------------------------------------------------------------------
  // GPS data detection
  // -----------------------------------------------------------------------

  it("detects GPS data as positive signal", () => {
    const data: ExifData = {
      Image: {
        Make: "Apple",
        Model: "iPhone 15",
        DateTime: new Date("2024-01-01T12:00:00Z"),
      },
      Photo: {
        ExposureTime: 0.001,
        FNumber: 1.8,
        FocalLength: 6,
        DateTimeOriginal: new Date("2024-01-01T12:00:00Z"),
      },
      GPSInfo: {
        GPSLatitudeRef: "N",
        GPSLatitude: [37, 46, 29.0],
        GPSLongitudeRef: "W",
        GPSLongitude: [122, 25, 10.0],
      },
    };

    const result = reviewExif(data);
    expect(result.positiveSignals.some((s) => s.code === "gps-data")).toBe(
      true
    );
    expect(result.assessment).toBe("likely-camera-capture");
    expect(result.confidence).toBe("high");
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("handles data with only software tag", () => {
    const data: ExifData = {
      Image: {
        Software: "GIMP 2.10",
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("limited-evidence");
    expect(
      result.cautionSignals.some((s) => s.code === "software-editor")
    ).toBe(true);
  });

  it("handles data with ProcessingSoftware tag", () => {
    const data: ExifData = {
      Photo: {
        ProcessingSoftware: "Darktable 4.0",
      },
    };

    const result = reviewExif(data);
    expect(
      result.cautionSignals.some((s) => s.code === "software-editor")
    ).toBe(true);
  });

  it("returns limited-evidence for IFD groups with unrecognized tags", () => {
    // An image has IFD data but none of our detectors recognize the tags.
    const data: ExifData = {
      Image: {
        SomeUnknownTag: 42,
      },
      Photo: {
        AnotherUnknownTag: "value",
      },
    };

    const result = reviewExif(data);
    expect(result.assessment).toBe("limited-evidence");
    expect(result.confidence).toBe("low");
    // No detectors matched specifically, but IFD data exists.
    expect(result.positiveSignals).toEqual([]);
    expect(result.cautionSignals).toEqual([]);
    expect(result.missingSignals).toContain("camera-make-model");
  });

  it("includes disclaimer in every result", () => {
    expect(reviewExif(null).disclaimer).toBe(DISCLAIMER);
    expect(reviewExif({}).disclaimer).toBe(DISCLAIMER);
    expect(
      reviewExif({
        Image: { Make: "Canon", Model: "5D", DateTime: new Date() },
        Photo: {
          ExposureTime: 1 / 250,
          FNumber: 8,
          DateTimeOriginal: new Date(),
        },
      }).disclaimer
    ).toBe(DISCLAIMER);
  });

  it("is deterministic", () => {
    const data: ExifData = {
      Image: {
        Make: "Fuji",
        Model: "X-T5",
        DateTime: new Date("2024-06-01T08:00:00Z"),
      },
      Photo: {
        ExposureTime: 0.002,
        FNumber: 4,
        DateTimeOriginal: new Date("2024-06-01T08:00:00Z"),
      },
    };

    const r1 = reviewExif(data);
    const r2 = reviewExif(data);
    expect(r1).toEqual(r2);
  });

  it("has no inferred authenticity fields", () => {
    const data: ExifData = {
      Image: {
        Make: "Leica",
        Model: "M11",
        DateTime: new Date(),
      },
      Photo: {
        ExposureTime: 0.01,
        FNumber: 2,
        DateTimeOriginal: new Date(),
      },
    };

    const result = reviewExif(data);
    expect((result as any).isGenuine).toBeUndefined();
    expect((result as any).isFake).toBeUndefined();
    expect((result as any).cameraTaken).toBeUndefined();
    expect((result as any).confidence_score).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // C2PA integration
  // -----------------------------------------------------------------------

  it("adds c2pa-manifest-present positive signal when C2PA detected", () => {
    const data: ExifData = {
      Image: {
        Make: "Canon",
        Model: "EOS R5",
        DateTime: new Date("2024-01-15T12:00:00Z"),
      },
      Photo: {
        ExposureTime: 0.004,
        FNumber: 5.6,
        ISOSpeedRatings: 400,
        FocalLength: 50,
        DateTimeOriginal: new Date("2024-01-15T12:00:00Z"),
      },
    };

    const result = reviewExif(data, undefined, {
      detected: true,
      label: "c2pa-manifest",
    });
    expect(result.c2pa).toEqual({
      detected: true,
      label: "c2pa-manifest",
    });
    expect(
      result.positiveSignals.some((s) => s.code === "c2pa-manifest-present")
    ).toBe(true);
    // C2PA is additive – assessment still driven by EXIF evidence
    expect(result.assessment).toBe("likely-camera-capture");
  });

  it("does not add c2pa signal when C2PA not detected", () => {
    const data: ExifData = {
      Image: {
        Make: "Canon",
        Model: "EOS R5",
        DateTime: new Date("2024-01-15T12:00:00Z"),
      },
      Photo: {
        ExposureTime: 0.004,
        FNumber: 5.6,
        DateTimeOriginal: new Date("2024-01-15T12:00:00Z"),
      },
    };

    const result = reviewExif(data, undefined, {
      detected: false,
      label: null,
    });
    expect(result.c2pa).toEqual({ detected: false, label: null });
    expect(
      result.positiveSignals.some((s) => s.code === "c2pa-manifest-present")
    ).toBe(false);
  });

  it("c2pa field absent when not provided (backward compat)", () => {
    const data: ExifData = {
      Image: {
        Make: "Canon",
        Model: "EOS R5",
        DateTime: new Date("2024-01-15T12:00:00Z"),
      },
      Photo: {
        ExposureTime: 0.004,
        FNumber: 5.6,
        DateTimeOriginal: new Date("2024-01-15T12:00:00Z"),
      },
    };

    const result = reviewExif(data);
    expect(result.c2pa).toBeUndefined();
  });

  it("surfaces c2pa with null EXIF (no-metadata assessment)", () => {
    const result = reviewExif(null, undefined, {
      detected: true,
      label: "c2pa-manifest",
    });
    expect(result.assessment).toBe("no-metadata");
    expect(result.c2pa).toEqual({
      detected: true,
      label: "c2pa-manifest",
    });
  });

  it("surfaces c2pa with no EXIF but c2pa field present on no-metadata", () => {
    const result = reviewExif(null, undefined, {
      detected: false,
      label: null,
    });
    expect(result.assessment).toBe("no-metadata");
    expect(result.c2pa).toEqual({ detected: false, label: null });
  });
});
