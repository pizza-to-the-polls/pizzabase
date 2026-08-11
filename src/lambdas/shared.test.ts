import { scrubExifData } from "../../lambdas/shared";

describe("scrubExifData", () => {
  it("removes GPSInfo group entirely", () => {
    const data = {
      Image: {
        Make: "Apple",
        Model: "iPhone 15",
      },
      GPSInfo: {
        GPSLatitudeRef: "N",
        GPSLatitude: [37, 46, 29],
        GPSLongitudeRef: "W",
        GPSLongitude: [122, 25, 10],
      },
    };

    const cleaned = scrubExifData(data);
    expect(cleaned.GPSInfo).toBeUndefined();
    expect(cleaned.Image).toBeDefined();
    expect((cleaned.Image as any).Make).toBe("Apple");
  });

  it("removes serial number tags", () => {
    const data = {
      Photo: {
        BodySerialNumber: "ABC123",
        SerialNumber: "XYZ789",
        LensSerialNumber: "LENS001",
        ExposureTime: 0.004,
        FNumber: 5.6,
      },
    };

    const cleaned = scrubExifData(data);
    const photo = cleaned.Photo as any;
    expect(photo.BodySerialNumber).toBeUndefined();
    expect(photo.SerialNumber).toBeUndefined();
    expect(photo.LensSerialNumber).toBeUndefined();
    expect(photo.ExposureTime).toBe(0.004);
    expect(photo.FNumber).toBe(5.6);
  });

  it("removes CameraSerialNumber and InternalSerialNumber", () => {
    const data = {
      Photo: {
        CameraSerialNumber: "CAM456",
        InternalSerialNumber: "INT789",
      },
    };

    const cleaned = scrubExifData(data);
    const photo = cleaned.Photo as any;
    expect(photo.CameraSerialNumber).toBeUndefined();
    expect(photo.InternalSerialNumber).toBeUndefined();
  });

  it("removes timestamp tags", () => {
    const data = {
      Image: {
        Make: "Sony",
        DateTime: "2024:01:15 12:00:00",
      },
      Photo: {
        DateTimeOriginal: "2024:01:15 12:00:00",
        DateTimeDigitized: "2024:01:15 12:00:01",
        SubSecTimeOriginal: "123",
        SubSecTimeDigitized: "456",
        ExposureTime: 0.01,
      },
    };

    const cleaned = scrubExifData(data);
    const photo = cleaned.Photo as any;
    const image = cleaned.Image as any;

    expect(image.DateTime).toBeUndefined();
    expect(photo.DateTimeOriginal).toBeUndefined();
    expect(photo.DateTimeDigitized).toBeUndefined();
    expect(photo.SubSecTimeOriginal).toBeUndefined();
    expect(photo.SubSecTimeDigitized).toBeUndefined();
    expect(photo.ExposureTime).toBe(0.01);
    expect(image.Make).toBe("Sony");
  });

  it("handles gps key (lowercase) same as GPSInfo", () => {
    const data = {
      gps: {
        latitude: 40.7,
        longitude: -74.0,
      },
      Image: {
        Make: "Canon",
      },
    };

    const cleaned = scrubExifData(data);
    expect(cleaned.gps).toBeUndefined();
    expect(cleaned.Image).toBeDefined();
  });

  it("preserves non-PII data intact", () => {
    const data = {
      Image: {
        Make: "Nikon",
        Model: "Z6",
        Orientation: 1,
        XResolution: 300,
        YResolution: 300,
        ResolutionUnit: 2,
        Software: "Adobe Lightroom",
      },
      Photo: {
        ExposureTime: 0.001,
        FNumber: 4,
        ISOSpeedRatings: 400,
        FocalLength: 50,
        LensMake: "Nikon",
        LensModel: "24-70mm f/4",
        PixelXDimension: 6048,
        PixelYDimension: 4024,
        MakerNote: Buffer.from("nikon_data"),
      },
    };

    const cleaned = scrubExifData(data);
    const image = cleaned.Image as any;
    const photo = cleaned.Photo as any;

    expect(image.Make).toBe("Nikon");
    expect(image.Model).toBe("Z6");
    expect(image.Orientation).toBe(1);
    expect(image.Software).toBe("Adobe Lightroom");
    expect(photo.ExposureTime).toBe(0.001);
    expect(photo.FNumber).toBe(4);
    expect(photo.ISOSpeedRatings).toBe(400);
    expect(photo.FocalLength).toBe(50);
    expect(photo.LensMake).toBe("Nikon");
    expect(photo.LensModel).toBe("24-70mm f/4");
    expect(photo.PixelXDimension).toBe(6048);
    expect(photo.PixelYDimension).toBe(4024);
    expect(photo.MakerNote).toBeDefined();
  });

  it("returns empty cleaned object for empty input", () => {
    const cleaned = scrubExifData({});
    expect(Object.keys(cleaned)).toEqual([]);
  });

  it("handles null values in groups", () => {
    const data = {
      Image: {
        Make: null,
        Software: null,
        Orientation: 1,
      },
    };

    const cleaned = scrubExifData(data);
    const image = cleaned.Image as any;
    expect(image.Make).toBeNull();
    expect(image.Software).toBeNull();
    expect(image.Orientation).toBe(1);
  });
});
