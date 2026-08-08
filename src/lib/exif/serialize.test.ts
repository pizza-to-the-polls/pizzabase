/**
 * Tests for EXIF serialization (JSON-safe conversion for JSONB storage).
 */

import { serializeExif, deserializeExif } from "./serialize";

describe("serializeExif", () => {
  it("passes through plain primitives", () => {
    const input = {
      make: "Apple",
      model: "iPhone 15",
      count: 42,
      flag: false,
    };
    const output = serializeExif(input);
    expect(output).toEqual(input);
  });

  it("converts Buffer values to base64 wrappers", () => {
    const input = {
      thumbnail: Buffer.from("hello"),
    };
    const output = serializeExif(input);
    expect(output.thumbnail).toEqual({
      __type: "base64",
      data: Buffer.from("hello").toString("base64"),
    });
  });

  it("converts Date values to ISO strings", () => {
    const input = {
      capturedAt: new Date("2024-08-15T14:30:00Z"),
    };
    const output = serializeExif(input);
    expect(output.capturedAt).toBe("2024-08-15T14:30:00.000Z");
  });

  it("converts epoch dates to null", () => {
    const input = {
      badDate: new Date(0),
    };
    const output = serializeExif(input);
    expect(output.badDate).toBeNull();
  });

  it("handles nested objects", () => {
    const input = {
      image: {
        Make: "Apple",
        thumbnail: Buffer.from([0x01, 0x02]),
      },
    };
    const output = serializeExif(input);
    expect(output.image.Make).toBe("Apple");
    expect(output.image.thumbnail.__type).toBe("base64");
  });

  it("handles arrays", () => {
    const input = {
      tags: ["sunny", Buffer.from("raw"), new Date("2024-01-01T00:00:00Z")],
    };
    const output = serializeExif(input);
    expect(output.tags[0]).toBe("sunny");
    expect(output.tags[1].__type).toBe("base64");
    expect(output.tags[2]).toBe("2024-01-01T00:00:00.000Z");
  });

  it("returns a deep clone, not a reference", () => {
    const input = { make: "Apple" };
    const output = serializeExif(input);
    output.make = "Google";
    expect(input.make).toBe("Apple");
  });
});

describe("deserializeExif", () => {
  it("reconstitutes base64 wrappers to Buffers", () => {
    const serialized = {
      thumbnail: {
        __type: "base64",
        data: Buffer.from("hello").toString("base64"),
      },
    };
    const deserialized = deserializeExif(serialized);
    expect(Buffer.isBuffer(deserialized.thumbnail)).toBe(true);
    expect(deserialized.thumbnail.toString()).toBe("hello");
  });

  it("reconstitutes ISO date strings to Date objects", () => {
    const serialized = {
      capturedAt: "2024-08-15T14:30:00.000Z",
    };
    const deserialized = deserializeExif(serialized);
    expect(deserialized.capturedAt instanceof Date).toBe(true);
    expect((deserialized.capturedAt as Date).toISOString()).toBe(
      "2024-08-15T14:30:00.000Z"
    );
  });

  it("round-trips: serialize then deserialize preserves semantics", () => {
    const input = {
      image: {
        Make: "Apple",
        DateTimeOriginal: new Date("2024-08-15T14:30:00Z"),
      },
      thumbnail: Buffer.from("thumb-data"),
    };

    const serialized = serializeExif(input);
    const deserialized = deserializeExif(serialized);

    expect(deserialized.image.Make).toBe("Apple");
    expect(deserialized.image.DateTimeOriginal instanceof Date).toBe(true);
    expect(Buffer.isBuffer(deserialized.thumbnail)).toBe(true);
    expect(deserialized.thumbnail.toString()).toBe("thumb-data");
  });
});
