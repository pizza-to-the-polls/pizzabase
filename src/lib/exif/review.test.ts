/**
 * Tests for EXIF review heuristic (camera vs screenshot detection).
 */

import { reviewExif } from "./review";

describe("reviewExif", () => {
  it("returns unknown for null input", () => {
    const r = reviewExif(null);
    expect(r.source).toBe("unknown");
    expect(r.hasGps).toBe(false);
    expect(r.software).toBeNull();
    expect(r.camera).toBeNull();
  });

  it("detects camera when Make and Model are present", () => {
    const exifData = {
      image: {
        Make: "Apple",
        Model: "iPhone 15 Pro",
      },
    };

    const r = reviewExif(exifData);
    expect(r.source).toBe("camera");
    expect(r.camera).toBe("Apple iPhone 15 Pro");
  });

  it("detects camera with capitalized keys (backward compat)", () => {
    const exifData = {
      Image: {
        Make: "Canon",
        Model: "EOS R5",
      },
    };

    const r = reviewExif(exifData);
    expect(r.source).toBe("camera");
    expect(r.camera).toBe("Canon EOS R5");
  });

  it("detects screenshot from software name", () => {
    const exifData = {
      image: {
        Software: "Snagit 2024",
      },
    };

    const r = reviewExif(exifData);
    expect(r.source).toBe("screenshot");
    expect(r.software).toBe("Snagit 2024");
  });

  it("detects screenshot from UserComment", () => {
    const exifData = {
      exif: {
        UserComment: Buffer.from("Screenshot"),
      },
    };

    const r = reviewExif(exifData);
    expect(r.source).toBe("screenshot");
  });

  it("detects screenshot from ImageDescription", () => {
    const exifData = {
      image: {
        ImageDescription: "Screen capture from iPhone",
      },
    };

    const r = reviewExif(exifData);
    expect(r.source).toBe("screenshot");
  });

  it("detects GPS presence", () => {
    const exifData = {
      gps: {
        GPSLatitude: 40.7128,
        GPSLongitude: -74.006,
      },
    };

    const r = reviewExif(exifData);
    expect(r.hasGps).toBe(true);
  });

  it("reports no GPS when coordinates are missing", () => {
    const exifData = {
      gps: {
        GPSLatitude: null,
      },
    };

    const r = reviewExif(exifData);
    expect(r.hasGps).toBe(false);
  });

  it("returns no GPS when gps group is absent", () => {
    const exifData = {
      image: { Make: "Apple" },
    };

    const r = reviewExif(exifData);
    expect(r.hasGps).toBe(false);
  });

  it("extracts image dimensions", () => {
    const exifData = {
      image: {
        ImageWidth: 4032,
        ImageHeight: 3024,
      },
    };

    const r = reviewExif(exifData);
    expect(r.dimensions).toEqual({ width: 4032, height: 3024 });
  });

  it("handles missing dimensions", () => {
    const exifData = {
      image: {},
    };

    const r = reviewExif(exifData);
    expect(r.dimensions).toBeNull();
  });

  it("extracts capture timestamp", () => {
    const exifData = {
      exif: {
        DateTimeOriginal: "2024:08:15 14:30:00",
      },
    };

    const r = reviewExif(exifData);
    expect(r.capturedAt).toBe("2024:08:15 14:30:00");
  });

  it("handles Buffer values in text fields", () => {
    const exifData = {
      exif: {
        UserComment: Buffer.from("Screenshot captured"),
        DateTimeOriginal: Buffer.from("2024:01:01 12:00:00"),
      },
    };

    const r = reviewExif(exifData);
    expect(r.source).toBe("screenshot");
    expect(r.capturedAt).toBe("2024:01:01 12:00:00");
  });

  it("is unknown for completely bare EXIF", () => {
    const exifData = {
      image: {},
    };

    const r = reviewExif(exifData);
    expect(r.source).toBe("unknown");
  });

  it("returns unknown for empty object", () => {
    const r = reviewExif({});
    expect(r.source).toBe("unknown");
  });

  it("detects CleanShot as screenshot software", () => {
    const exifData = {
      image: {
        Software: "CleanShot X",
      },
    };

    const r = reviewExif(exifData);
    expect(r.source).toBe("screenshot");
  });

  it("does not classify regular software as screenshot", () => {
    const exifData = {
      image: {
        Software: "Adobe Photoshop 2024",
      },
    };

    const r = reviewExif(exifData);
    // Photoshop is not in the screenshot software list and no
    // screenshot markers in comments → should stay unknown
    expect(r.source).not.toBe("screenshot");
  });

  it("handles capitalized GPSInfo key (backward compat)", () => {
    const exifData = {
      GPSInfo: {
        GPSLatitude: 42.3601,
        GPSLongitude: -71.0589,
      },
    };

    const r = reviewExif(exifData);
    expect(r.hasGps).toBe(true);
  });
});
