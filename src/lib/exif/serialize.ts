/**
 * Serialize exif-reader output into a JSON-safe form.
 *
 * exif-reader may return values that are not natively JSON-serializable:
 *   - Buffer objects (UNDEFINED type 7, or ASCII strings with high bits)
 *   - Date objects
 *
 * This module recursively walks the parsed EXIF object and converts every
 * non-JSON value into a stable, deterministic representation suitable for
 * an HTTP JSON response.
 */

/**
 * Recursively serialize parsed EXIF data to a JSON-safe representation.
 *
 * Transformations:
 *   - Buffer → { _bytes: "<base64>" }
 *   - Date    → ISO-8601 string
 *   - Arrays and plain objects are recursed into.
 *   - All other values (numbers, strings, booleans, null) pass through.
 */
export function serializeExif(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (Buffer.isBuffer(value)) {
    return { _bytes: value.toString("base64") };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeExif);
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      result[key] = serializeExif((value as Record<string, unknown>)[key]);
    }
    return result;
  }

  return value;
}
