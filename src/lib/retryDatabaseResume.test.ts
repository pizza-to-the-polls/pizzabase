import {
  DATABASE_RESUMING_MESSAGE,
  DEFAULT_RETRY_DELAYS_MS,
  isDatabaseResumingError,
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

  it("uses correct delays: 1s × 5, 2s, 4s", async () => {
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

    expect(delays).toEqual([1000, 1000, 1000, 1000, 1000, 2000, 4000]);
    // Called once initially + one per retry delay = 8 times total.
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
});
