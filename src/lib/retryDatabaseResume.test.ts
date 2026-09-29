import {
  DATA_API_5XX_DELAYS_MS,
  DATABASE_RESUMING_MESSAGE,
  DEFAULT_RETRY_DELAYS_MS,
  isDatabaseResumingError,
  isRetryableDataApiError,
  withDatabaseResumeRetry,
} from "./retryDatabaseResume";

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
 * Builds an error shaped like the AWS SDK v3 `InternalServerErrorException`
 * that surfaces from the RDS Data API client bundled inside
 * typeorm-aurora-data-api-driver (de_ExecuteStatementCommandError →
 * de_InternalServerErrorExceptionRes). Constructed inline (name + $metadata)
 * rather than via the real SDK class because the exception is bundled inside
 * the driver's UMD — detection must work by name/$metadata, not instanceof.
 */
function dataApi500Error(requestId?: string): Error {
  return Object.assign(new Error("UnknownError"), {
    name: "InternalServerErrorException",
    $metadata: {
      httpStatusCode: 500,
      attempts: 3,
      totalRetryDelay: 0,
      ...(requestId ? { requestId } : {}),
    },
  });
}

const SELECT_QUERY = 'SELECT * FROM "order" WHERE id = $1';
const WITH_QUERY =
  'WITH recent AS (SELECT id FROM "order") SELECT * FROM recent';
const INSERT_QUERY = 'INSERT INTO "order" (id) VALUES ($1)';
const UPDATE_QUERY = 'UPDATE "order" SET total = 1 WHERE id = $1';
const DELETE_QUERY = 'DELETE FROM "order" WHERE id = $1';

// ── isDatabaseResumingError ────────────────────────────────────────

describe("isDatabaseResumingError", () => {
  it("returns true for message containing the resume phrase", () => {
    expect(isDatabaseResumingError(resumeError())).toBe(true);
  });

  it("returns true when the message has extra leading/trailing text", () => {
    const err = resumeError();
    // Sanity check: the phrase is embedded, not the whole message.
    expect(err.message.length).toBeGreaterThan(
      DATABASE_RESUMING_MESSAGE.length,
    );
    expect(isDatabaseResumingError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isDatabaseResumingError(otherError())).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isDatabaseResumingError("just a string")).toBe(false);
    expect(isDatabaseResumingError(null)).toBe(false);
    expect(isDatabaseResumingError(undefined)).toBe(false);
    expect(isDatabaseResumingError(42)).toBe(false);
    expect(
      isDatabaseResumingError({ message: DATABASE_RESUMING_MESSAGE }),
    ).toBe(false); // not an Error instance
  });

  it("returns false for errors without the phrase in their message", () => {
    expect(isDatabaseResumingError(new Error("some other message"))).toBe(
      false,
    );
    expect(isDatabaseResumingError(new TypeError("TypeError message"))).toBe(
      false,
    );
  });
});

// ── withDatabaseResumeRetry ────────────────────────────────────────

describe("withDatabaseResumeRetry", () => {
  it("returns result on first success (no retry, no delay)", async () => {
    const fn = jest.fn().mockResolvedValue(42);

    const result = await withDatabaseResumeRetry(fn, {
      sleep: fakeSleep,
    });

    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on resume error until success", async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) {
        throw resumeError();
      }
      return "ok";
    });

    const result = await withDatabaseResumeRetry(fn, {
      sleep: fakeSleep,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses correct delays: 1s×5, 2s×3, 3s×3, 4s", async () => {
    const delays: number[] = [];

    // A function that always throws resume errors so we exercise every retry.
    const fn = jest.fn().mockRejectedValue(resumeError());

    await expect(
      withDatabaseResumeRetry(fn, {
        sleep: async (ms: number) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow(DATABASE_RESUMING_MESSAGE);

    expect(delays).toEqual([
      1000, 1000, 1000, 1000, 1000, 2000, 2000, 2000, 3000, 3000, 3000, 4000,
    ]);
    // Called once initially + one per retry delay = 13 times total.
    expect(fn).toHaveBeenCalledTimes(DEFAULT_RETRY_DELAYS_MS.length + 1);
  });

  it("does NOT retry non-resume errors (propagates immediately)", async () => {
    const fn = jest.fn().mockRejectedValue(otherError());

    await expect(
      withDatabaseResumeRetry(fn, { sleep: fakeSleep }),
    ).rejects.toThrow("does not exist");

    // Called exactly once — no retries.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the original (first) error after exhausting all retries", async () => {
    const firstError = resumeError();
    // All calls must throw resume errors so retries are actually
    // attempted. Use different instances to verify the *first* one
    // is re-thrown, not the last.
    const fn = jest
      .fn()
      .mockRejectedValueOnce(firstError)
      .mockRejectedValue(
        new Error(`different later error with ${DATABASE_RESUMING_MESSAGE}`),
      );

    await expect(
      withDatabaseResumeRetry(fn, { sleep: fakeSleep }),
    ).rejects.toBe(firstError);

    // Called once initially + one per retry delay.
    expect(fn).toHaveBeenCalledTimes(DEFAULT_RETRY_DELAYS_MS.length + 1);
  });

  it("logs each retry at warn level", async () => {
    const logger = jest.fn();

    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) {
        throw resumeError();
      }
      return "done";
    });

    await withDatabaseResumeRetry(fn, {
      sleep: fakeSleep,
      logger,
    });

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("Database is resuming, retrying in"),
    );
  });

  it("uses the provided sleep function", async () => {
    const slept: number[] = [];
    const sleep = jest.fn().mockImplementation((ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    });

    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) {
        throw resumeError();
      }
      return "ok";
    });

    await withDatabaseResumeRetry(fn, { sleep });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(slept).toEqual([1000]);
  });

  it("works with function that succeeds on the final retry attempt", async () => {
    const maxRetries = DEFAULT_RETRY_DELAYS_MS.length;
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls <= maxRetries) {
        throw resumeError();
      }
      return "last-chance";
    });

    const result = await withDatabaseResumeRetry(fn, {
      sleep: fakeSleep,
    });

    expect(result).toBe("last-chance");
    expect(fn).toHaveBeenCalledTimes(maxRetries + 1);
  });

  it("respects custom delaysMs", async () => {
    const customDelays = [500, 1000];
    const delays: number[] = [];

    const fn = jest.fn().mockRejectedValue(resumeError());

    await expect(
      withDatabaseResumeRetry(fn, {
        delaysMs: customDelays,
        sleep: async (ms: number) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow(DATABASE_RESUMING_MESSAGE);

    expect(delays).toEqual([500, 1000]);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("retries on every resume error in sequence until success", async () => {
    // First 4 attempts throw resume errors, 5th succeeds
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls <= 4) {
        throw resumeError();
      }
      return "recovered";
    });

    const result = await withDatabaseResumeRetry(fn, {
      sleep: fakeSleep,
    });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(5);
  });

  describe("default logger", () => {
    it("uses console.warn by default", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      let calls = 0;
      const fn = jest.fn().mockImplementation(async () => {
        calls++;
        if (calls < 2) {
          throw resumeError();
        }
        return "ok";
      });

      try {
        await withDatabaseResumeRetry(fn, { sleep: fakeSleep });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Database is resuming, retrying in"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("edge cases", () => {
    it("handles an empty delaysMs array (no retries)", async () => {
      const fn = jest.fn().mockRejectedValue(resumeError());

      await expect(
        withDatabaseResumeRetry(fn, {
          delaysMs: [],
          sleep: fakeSleep,
        }),
      ).rejects.toThrow(DATABASE_RESUMING_MESSAGE);

      // Called exactly once — no retries with empty delays.
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("re-throws non-resume error even after some resume errors", async () => {
      let calls = 0;
      const fn = jest.fn().mockImplementation(async () => {
        calls++;
        if (calls === 1) {
          throw resumeError(); // first attempt: resume
        }
        // second attempt: non-resume — should propagate immediately
        throw otherError();
      });

      await expect(
        withDatabaseResumeRetry(fn, { sleep: fakeSleep }),
      ).rejects.toThrow("does not exist");

      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("Data API 5xx retry path", () => {
    it("retries on 5xx until success using the short delay schedule", async () => {
      const delays: number[] = [];
      let calls = 0;
      const fn = jest.fn().mockImplementation(async () => {
        calls++;
        if (calls < 3) {
          throw dataApi500Error();
        }
        return "ok";
      });

      const result = await withDatabaseResumeRetry(fn, {
        sleep: async (ms: number) => {
          delays.push(ms);
        },
        queryText: SELECT_QUERY,
      });

      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
      expect(delays).toEqual([1000, 2000]);
    });

    it("uses the full short schedule [1000, 2000, 4000, 4000] when 5xx persists", async () => {
      const delays: number[] = [];
      const fn = jest.fn().mockRejectedValue(dataApi500Error());

      await expect(
        withDatabaseResumeRetry(fn, {
          sleep: async (ms: number) => {
            delays.push(ms);
          },
          queryText: SELECT_QUERY,
        }),
      ).rejects.toThrow("UnknownError");

      expect(delays).toEqual(DATA_API_5XX_DELAYS_MS);
      expect(delays).toEqual([1000, 2000, 4000, 4000]);
      // Initial call + one per retry delay = 5 calls total (not 13 like
      // the resume schedule — the SDK already spent ~30s retrying).
      expect(fn).toHaveBeenCalledTimes(DATA_API_5XX_DELAYS_MS.length + 1);
    });

    it("throws the original 5xx error after exhausting the short schedule", async () => {
      const firstError = dataApi500Error("first-request-id");
      const fn = jest
        .fn()
        .mockRejectedValueOnce(firstError)
        .mockRejectedValue(dataApi500Error("later-request-id"));

      await expect(
        withDatabaseResumeRetry(fn, {
          sleep: fakeSleep,
          queryText: SELECT_QUERY,
        }),
      ).rejects.toBe(firstError);

      expect(fn).toHaveBeenCalledTimes(DATA_API_5XX_DELAYS_MS.length + 1);
    });

    it("does NOT retry 5xx for non-idempotent queries when queryText is given", async () => {
      for (const query of [INSERT_QUERY, UPDATE_QUERY, DELETE_QUERY]) {
        const fn = jest.fn().mockRejectedValue(dataApi500Error());

        await expect(
          withDatabaseResumeRetry(fn, {
            sleep: fakeSleep,
            queryText: query,
          }),
        ).rejects.toThrow("UnknownError");

        // Propagated immediately — no retries (duplicate-write risk).
        expect(fn).toHaveBeenCalledTimes(1);
      }
    });

    it("retries 5xx for SELECT queries when queryText is given", async () => {
      let calls = 0;
      const fn = jest.fn().mockImplementation(async () => {
        calls++;
        if (calls < 2) {
          throw dataApi500Error();
        }
        return "rows";
      });

      const result = await withDatabaseResumeRetry(fn, {
        sleep: fakeSleep,
        queryText: SELECT_QUERY,
      });

      expect(result).toBe("rows");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("retries 5xx for WITH (CTE) queries when queryText is given", async () => {
      let calls = 0;
      const fn = jest.fn().mockImplementation(async () => {
        calls++;
        if (calls < 2) {
          throw dataApi500Error();
        }
        return "rows";
      });

      const result = await withDatabaseResumeRetry(fn, {
        sleep: fakeSleep,
        queryText: WITH_QUERY,
      });

      expect(result).toBe("rows");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("retries 5xx when no queryText is provided (transaction-style calls)", async () => {
      let calls = 0;
      const fn = jest.fn().mockImplementation(async () => {
        calls++;
        if (calls < 2) {
          throw dataApi500Error();
        }
        return "committed";
      });

      const result = await withDatabaseResumeRetry(fn, { sleep: fakeSleep });

      expect(result).toBe("committed");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("logs httpStatusCode and requestId at warn level for 5xx retries", async () => {
      const logger = jest.fn();
      let calls = 0;
      const fn = jest.fn().mockImplementation(async () => {
        calls++;
        if (calls < 3) {
          throw dataApi500Error("a1b2c3d4-1234");
        }
        return "ok";
      });

      await withDatabaseResumeRetry(fn, {
        sleep: fakeSleep,
        logger,
        queryText: SELECT_QUERY,
      });

      expect(logger).toHaveBeenCalledTimes(2);
      expect(logger).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("RDS Data API returned a 5xx error"),
      );
      expect(logger).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("status=500"),
      );
      expect(logger).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("requestId=a1b2c3d4-1234"),
      );
      expect(logger).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("(attempt 2/4)"),
      );
    });

    it("propagates non-retryable 4xx errors immediately (no resume message)", async () => {
      const badRequest = Object.assign(new Error("Query execution failed"), {
        name: "BadRequestException",
        $metadata: { httpStatusCode: 400 },
      });
      const fn = jest.fn().mockRejectedValue(badRequest);

      await expect(
        withDatabaseResumeRetry(fn, { sleep: fakeSleep }),
      ).rejects.toBe(badRequest);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("keeps the long resume schedule when the first error is a resume error", async () => {
      // Documented behavior: the schedule is picked from the FIRST error
      // and is not switched mid-flight, even if later attempts 5xx. After
      // exhausting retries the first error is re-thrown (consistent with
      // the existing resume-error behavior).
      const delays: number[] = [];
      const firstError = resumeError();
      const fn = jest
        .fn()
        .mockRejectedValueOnce(firstError)
        .mockRejectedValue(dataApi500Error());

      await expect(
        withDatabaseResumeRetry(fn, {
          sleep: async (ms: number) => {
            delays.push(ms);
          },
        }),
      ).rejects.toBe(firstError);

      expect(delays).toEqual(DEFAULT_RETRY_DELAYS_MS);
      expect(fn).toHaveBeenCalledTimes(DEFAULT_RETRY_DELAYS_MS.length + 1);
    });

    it("respects an explicit delaysMs over the 5xx schedule", async () => {
      const delays: number[] = [];
      const fn = jest.fn().mockRejectedValue(dataApi500Error());

      await expect(
        withDatabaseResumeRetry(fn, {
          delaysMs: [10, 20],
          sleep: async (ms: number) => {
            delays.push(ms);
          },
        }),
      ).rejects.toThrow("UnknownError");

      expect(delays).toEqual([10, 20]);
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe("delay schedules", () => {
    it("keeps DEFAULT_RETRY_DELAYS_MS unchanged (12 retries, resume schedule)", () => {
      expect(DEFAULT_RETRY_DELAYS_MS).toEqual([
        1000, 1000, 1000, 1000, 1000, 2000, 2000, 2000, 3000, 3000, 3000, 4000,
      ]);
    });

    it("uses a short schedule for 5xx retries (3 retries, ~11s total)", () => {
      expect(DATA_API_5XX_DELAYS_MS).toEqual([1000, 2000, 4000, 4000]);
      expect(DATA_API_5XX_DELAYS_MS.length).toBeLessThan(
        DEFAULT_RETRY_DELAYS_MS.length,
      );
      expect(DATA_API_5XX_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThan(
        12_000,
      );
    });
  });
});

// ── isRetryableDataApiError ─────────────────────────────────────

describe("isRetryableDataApiError", () => {
  describe("resume errors (always retryable)", () => {
    it("returns true for resume errors", () => {
      expect(isRetryableDataApiError(resumeError())).toBe(true);
    });

    it("returns true for resume errors regardless of queryText", () => {
      // Even a write query is retried on a resume error: a paused DB
      // rejects the request before anything executes.
      expect(isRetryableDataApiError(resumeError(), INSERT_QUERY)).toBe(true);
    });
  });

  describe("Data API 5xx errors", () => {
    it("returns true for InternalServerErrorException with message UnknownError", () => {
      expect(isRetryableDataApiError(dataApi500Error())).toBe(true);
    });

    it("returns true for any error with $metadata.httpStatusCode >= 500", () => {
      const generic500 = Object.assign(new Error("boom"), {
        $metadata: { httpStatusCode: 502 },
      });
      expect(isRetryableDataApiError(generic500)).toBe(true);
    });

    it("returns true for 5xx with SELECT queryText", () => {
      expect(isRetryableDataApiError(dataApi500Error(), SELECT_QUERY)).toBe(
        true,
      );
    });

    it("returns true for 5xx with WITH (CTE) queryText", () => {
      expect(isRetryableDataApiError(dataApi500Error(), WITH_QUERY)).toBe(true);
    });

    it("is case-insensitive for select/with query prefixes", () => {
      expect(isRetryableDataApiError(dataApi500Error(), "  select 1")).toBe(
        true,
      );
      const cteQuery = "\n  WITH x AS (SELECT 1) SELECT * FROM x";
      expect(isRetryableDataApiError(dataApi500Error(), cteQuery)).toBe(true);
    });

    it("returns true for 5xx when no queryText is provided", () => {
      expect(isRetryableDataApiError(dataApi500Error())).toBe(true);
      expect(isRetryableDataApiError(dataApi500Error(), undefined)).toBe(true);
    });

    it("returns false for 5xx with INSERT queryText (idempotency guard)", () => {
      expect(isRetryableDataApiError(dataApi500Error(), INSERT_QUERY)).toBe(
        false,
      );
    });

    it("returns false for 5xx with UPDATE queryText (idempotency guard)", () => {
      expect(isRetryableDataApiError(dataApi500Error(), UPDATE_QUERY)).toBe(
        false,
      );
    });

    it("returns false for 5xx with DELETE queryText (idempotency guard)", () => {
      expect(isRetryableDataApiError(dataApi500Error(), DELETE_QUERY)).toBe(
        false,
      );
    });

    it("returns false for 5xx with empty queryText", () => {
      expect(isRetryableDataApiError(dataApi500Error(), "")).toBe(false);
    });
  });

  describe("non-retryable errors", () => {
    it("returns false for unrelated DB errors (missing relation)", () => {
      expect(isRetryableDataApiError(otherError())).toBe(false);
    });

    it("returns false for constraint violations", () => {
      const constraintError = new Error(
        'duplicate key value violates unique constraint "UQ_order_id"',
      );
      expect(isRetryableDataApiError(constraintError)).toBe(false);
    });

    it("returns false for SQL syntax errors", () => {
      const syntaxError = new Error('syntax error at or near "SELEC"');
      expect(isRetryableDataApiError(syntaxError)).toBe(false);
    });

    it("returns false for a 4xx BadRequestException without the resume message", () => {
      const badRequest = Object.assign(new Error("Query execution failed"), {
        name: "BadRequestException",
        $metadata: { httpStatusCode: 400 },
      });
      expect(isRetryableDataApiError(badRequest)).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isRetryableDataApiError("just a string")).toBe(false);
      expect(isRetryableDataApiError(null)).toBe(false);
      expect(isRetryableDataApiError(undefined)).toBe(false);
      expect(isRetryableDataApiError(42)).toBe(false);
    });

    it("returns false for plain objects without 5xx signals", () => {
      // 5xx detection is duck-typed (name/$metadata) so it survives the
      // driver's UMD bundle, but a plain object with no such signals is
      // not retryable.
      expect(
        isRetryableDataApiError({ message: "oops" } as unknown as Error),
      ).toBe(false);
    });
  });
});
