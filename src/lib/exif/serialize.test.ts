import { serializeExif } from "./serialize";

describe("serializeExif", () => {
  it("returns null for null/undefined", () => {
    expect(serializeExif(null)).toBeNull();
    expect(serializeExif(undefined)).toBeNull();
  });

  it("passes through numbers", () => {
    expect(serializeExif(42)).toBe(42);
    expect(serializeExif(3.14)).toBe(3.14);
    expect(serializeExif(0)).toBe(0);
    expect(serializeExif(-1)).toBe(-1);
  });

  it("passes through strings", () => {
    expect(serializeExif("hello")).toBe("hello");
    expect(serializeExif("")).toBe("");
  });

  it("passes through booleans", () => {
    expect(serializeExif(true)).toBe(true);
    expect(serializeExif(false)).toBe(false);
  });

  it("serializes Buffer to { _bytes: base64 }", () => {
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const result = serializeExif(buf) as { _bytes: string };
    expect(result._bytes).toBe("SGVsbG8=");
  });

  it("serializes Date to ISO string", () => {
    const d = new Date("2024-01-15T12:00:00Z");
    expect(serializeExif(d)).toBe("2024-01-15T12:00:00.000Z");
  });

  it("serializes arrays recursively", () => {
    const input = [1, Buffer.from("ab"), "string"];
    const result = serializeExif(input) as unknown[];
    expect(result[0]).toBe(1);
    expect((result[1] as any)._bytes).toBe("YWI=");
    expect(result[2]).toBe("string");
  });

  it("serializes nested objects recursively", () => {
    const input = {
      Image: {
        Make: "Apple",
        XResolution: 72,
      },
      Photo: {
        ExifVersion: Buffer.from([0x30, 0x32, 0x33, 0x30]), // "0230"
        DateTimeOriginal: new Date("2024-06-01T08:00:00Z"),
      },
    };

    const result = serializeExif(input) as any;
    expect(result.Image.Make).toBe("Apple");
    expect(result.Image.XResolution).toBe(72);
    expect(result.Photo.ExifVersion._bytes).toBe(
      Buffer.from([0x30, 0x32, 0x33, 0x30]).toString("base64")
    );
    expect(result.Photo.DateTimeOriginal).toBe("2024-06-01T08:00:00.000Z");
  });

  it("handles empty objects", () => {
    expect(serializeExif({})).toEqual({});
  });

  it("handles empty arrays", () => {
    expect(serializeExif([])).toEqual([]);
  });
});
