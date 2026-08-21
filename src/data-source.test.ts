import {
  sanitizeQueryParameters,
  installAuroraCompatibilityPatches,
} from "./data-source";
import { DATABASE_RESUMING_MESSAGE } from "./lib/retryDatabaseResume";

// ── Helpers ────────────────────────────────────────────────────────

function resumeError(): Error {
  return new Error(
    `The Aurora DB instance db-XXX is ${DATABASE_RESUMING_MESSAGE}. ` +
      "Please wait a few seconds and try again.",
  );
}

function otherError(): Error {
  return new Error('relation "nonexistent" does not exist');
}

function fakeSleep(): Promise<void> {
  return Promise.resolve();
}

/**
 * Builds a minimal fake driver that records params when query() is called.
 * The fake's createQueryRunner returns a queryRunner stub that stores
 * every (query, parameters, useStructuredResult) triple in recordedCalls.
 */
function fakeDriver() {
  const recordedCalls: Array<{
    query: string;
    parameters?: any[];
    useStructuredResult?: boolean;
  }> = [];

  return {
    recordedCalls,
    createQueryRunner: (_mode?: any) => ({
      query: (
        query: string,
        parameters?: any[],
        useStructuredResult?: boolean,
      ) => {
        recordedCalls.push({ query, parameters, useStructuredResult });
        return Promise.resolve();
      },
    }),
  };
}

// ── sanitizeQueryParameters ────────────────────────────────────────

describe("sanitizeQueryParameters", () => {
  it("returns undefined/null as-is when input is undefined or null", () => {
    expect(sanitizeQueryParameters(undefined)).toBeUndefined();
    expect(sanitizeQueryParameters(null)).toBeNull();
  });

  it("replaces undefined with null in array params", () => {
    expect(sanitizeQueryParameters([1, undefined, "x", null])).toEqual([
      1,
      null,
      "x",
      null,
    ]);
  });

  it("returns empty array as-is", () => {
    expect(sanitizeQueryParameters([])).toEqual([]);
  });

  it("replaces undefined with null in named-param objects", () => {
    expect(
      sanitizeQueryParameters({ a: undefined, b: 1, c: null, d: "hi" }),
    ).toEqual({ a: null, b: 1, c: null, d: "hi" });
  });

  it("returns non-container values as-is", () => {
    expect(sanitizeQueryParameters(42 as any)).toBe(42);
    expect(sanitizeQueryParameters("string" as any)).toBe("string");
    expect(sanitizeQueryParameters(true as any)).toBe(true);
  });

  it("handles an array with only undefined entries", () => {
    expect(sanitizeQueryParameters([undefined, undefined])).toEqual([
      null,
      null,
    ]);
  });

  it("handles a named-param object with only undefined values", () => {
    expect(sanitizeQueryParameters({ x: undefined, y: undefined })).toEqual({
      x: null,
      y: null,
    });
  });

  it("handles a mixed array with objects (shallow only)", () => {
    // The sanitizer is intentionally shallow — nested containers are
    // not recursive. This matches pg's own behavior for top-level params.
    const nested = { inner: undefined };
    expect(sanitizeQueryParameters([1, nested, undefined])).toEqual([
      1,
      nested, // unchanged — shallow walk
      null,
    ]);
  });
});

// ── installAuroraCompatibilityPatches ──────────────────────────────

describe("installAuroraCompatibilityPatches", () => {
  it("sanitizes undefined params to null before query is called (AC-1)", async () => {
    const { recordedCalls, createQueryRunner } = fakeDriver();
    const driver = { createQueryRunner };

    installAuroraCompatibilityPatches(driver);

    const qr = (driver as any).createQueryRunner();
    await qr.query("SELECT $1, $2, $3", [1, undefined, "x"]);

    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].parameters).toEqual([1, null, "x"]);
  });

  it("preserves non-undefined params unchanged", async () => {
    const { recordedCalls, createQueryRunner } = fakeDriver();
    const driver = { createQueryRunner };

    installAuroraCompatibilityPatches(driver);

    const qr = (driver as any).createQueryRunner();
    await qr.query("SELECT $1, $2", [42, "hello"]);

    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].parameters).toEqual([42, "hello"]);
  });

  it("passes undefined parameters as-is (no-op for empty params)", async () => {
    const { recordedCalls, createQueryRunner } = fakeDriver();
    const driver = { createQueryRunner };

    installAuroraCompatibilityPatches(driver);

    const qr = (driver as any).createQueryRunner();
    await qr.query("SELECT 1");

    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].parameters).toBeUndefined();
  });

  it("retries on Aurora resume errors (preserves existing retry behavior)", async () => {
    let calls = 0;
    const driver = {
      createQueryRunner: (_mode?: any) => ({
        query: async () => {
          calls++;
          if (calls < 2) throw resumeError();
          return "ok";
        },
      }),
    };

    installAuroraCompatibilityPatches(driver, fakeSleep);

    const qr = (driver as any).createQueryRunner();
    const result = await qr.query("SELECT 1", [], undefined);

    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does NOT retry non-resume errors (propagates immediately)", async () => {
    let calls = 0;
    const driver = {
      createQueryRunner: (_mode?: any) => ({
        query: async () => {
          calls++;
          throw otherError();
        },
      }),
    };

    installAuroraCompatibilityPatches(driver);

    const qr = (driver as any).createQueryRunner();
    await expect(qr.query("SELECT 1")).rejects.toThrow("does not exist");
    expect(calls).toBe(1);
  });

  it("handles named-parameter object form (defensive coverage)", async () => {
    const { recordedCalls, createQueryRunner } = fakeDriver();
    const driver = { createQueryRunner };

    installAuroraCompatibilityPatches(driver);

    const qr = (driver as any).createQueryRunner();
    await qr.query("SELECT :a, :b", { a: undefined, b: "ok" });

    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].parameters).toEqual({ a: null, b: "ok" });
  });

  it("handles empty array params", async () => {
    const { recordedCalls, createQueryRunner } = fakeDriver();
    const driver = { createQueryRunner };

    installAuroraCompatibilityPatches(driver);

    const qr = (driver as any).createQueryRunner();
    await qr.query("SELECT 1", []);

    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].parameters).toEqual([]);
  });
});
