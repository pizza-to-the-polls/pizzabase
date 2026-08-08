/**
 * Serialize raw EXIF output from exif-reader into a JSON-safe structure.
 *
 * exif-reader can return:
 *   - Buffers (thumbnails, raw binary blobs)
 *   - Dates (Date objects)
 *   - Nested objects (Image, Photo, GPSInfo, etc.)
 *
 * All of these need to be converted to JSON-safe primitives so they can
 * be stored in a JSONB column and served as JSON API responses.
 */

export function serializeExif(data: Record<string, any>): Record<string, any> {
  return convert(data);
}

/**
 * Recursively convert values to JSON-safe primitives BEFORE handing
 * them to JSON.stringify.  This is necessary because Buffer and Date
 * both define .toJSON() methods that JSON.stringify invokes first —
 * a replacer never sees the original instances.
 */
function convert(value: any): any {
  // Buffers → base64 wrappers (checked first — Buffer is an object)
  if (Buffer.isBuffer(value)) {
    return { __type: "base64", data: value.toString("base64") };
  }

  // Dates → ISO strings (epoch → null for unparseable EXIF datetimes)
  if (value instanceof Date) {
    const iso = value.toISOString();
    if (iso.startsWith("1970-01-01")) {
      return null;
    }
    return iso;
  }

  // Arrays → map recursively
  if (Array.isArray(value)) {
    return value.map(convert);
  }

  // Plain objects → shallow-clone with converted values
  if (value && typeof value === "object") {
    const result: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      result[key] = convert(value[key]);
    }
    return result;
  }

  // Primitives (string, number, boolean, null, undefined) pass through
  return value;
}

/**
 * Reconstitute a serialized EXIF object back to its runtime form
 * (Buffer for thumbnails, Date objects for timestamps).
 */
export function deserializeExif(
  data: Record<string, any>
): Record<string, any> {
  function revive(_key: string, value: any): any {
    if (value && typeof value === "object" && value.__type === "base64") {
      return Buffer.from(value.data, "base64");
    }
    // ISO date strings that look like timestamps
    if (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
    ) {
      const d = new Date(value);
      if (d.getFullYear() !== 1970) {
        return d;
      }
      return value; // keep as string if it was the epoch
    }
    return value;
  }

  // Use the same pre-walk strategy as serializeExif to guard against
  // callers passing raw data that may still contain Buffer instances.
  return JSON.parse(JSON.stringify(convert(data)), revive);
}
