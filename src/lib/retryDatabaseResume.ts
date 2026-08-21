/**
 * Retry helper for Aurora Serverless v1 auto-pause resume errors.
 *
 * Aurora Serverless v1 auto-pauses after periods of inactivity and takes
 * several seconds to resume. During the resume window, every query via the
 * RDS Data API throws a BadRequestException with the message:
 *
 *   "The Aurora DB instance db-XXX is resuming after being auto-paused.
 *    Please wait a few seconds and try again."
 *
 * This module provides:
 *   1. Error detection — is the error a "resuming" error?
 *   2. Retry-with-backoff — flat delays for the typical ~5s resume window,
 *      then a small exponential tail for the rare slow wake-up.
 *
 * All delays and dependencies are injectable so the logic is fully
 * unit-testable without real timers or DB connections.
 */

// ── Constants ──────────────────────────────────────────────────────

/** Substring that uniquely identifies an Aurora Serverless resume error. */
export const DATABASE_RESUMING_MESSAGE = "resuming after being auto-paused";

/**
 * Default backoff delays in milliseconds.
 *
 * Strategy: mostly flat, small exponential tail.
 *   - First 5 retries: 1s each (covers the typical ~5s resume window)
 *   - Then: 2s, 4s (tail for the rare slow wake-up)
 *   - 7 retries total, ~11s total sleep time
 */
export const DEFAULT_RETRY_DELAYS_MS = [
  1000, 1000, 1000, 1000, 1000, 2000, 4000,
];

// ── Error detection ────────────────────────────────────────────────

/**
 * Returns `true` if `error` is a known Aurora Serverless resume error.
 *
 * The detection is based on the error message string, which is the
 * stable identifier regardless of the error class name used by the
 * AWS SDK or typeorm-aurora-data-api-driver.
 */
export function isDatabaseResumingError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes(DATABASE_RESUMING_MESSAGE);
  }
  return false;
}

// ── Retry options ─────────────────────────────────────────────────

export interface RetryOptions {
  /**
   * Delays between retries in milliseconds.
   *
   * @default DEFAULT_RETRY_DELAYS_MS
   */
  delaysMs?: number[];

  /**
   * Sleep function. Injectable for testing so tests don't actually wait.
   *
   * @default `(ms) => new Promise((r) => setTimeout(r, ms))`
   */
  sleep?: (ms: number) => Promise<void>;

  /**
   * Logger function. Injectable for testing.
   *
   * @default `console.warn`
   */
  logger?: (message: string, ...args: any[]) => void;
}

// ── Core retry logic ───────────────────────────────────────────────

/**
 * Executes `fn`. If it throws a "resuming after being auto-paused" error,
 * retries with flat-then-exponential backoff (see `DEFAULT_RETRY_DELAYS_MS`).
 *
 * **Key behaviors:**
 * - If `fn()` succeeds on the first call, the result is returned immediately
 *   (zero added latency during normal operation).
 * - If `fn()` throws a **non-resume** error, it propagates immediately — no
 *   retries for unrelated failures (SQL syntax errors, constraint violations,
 *   etc.).
 * - If `fn()` throws a resume error, it is retried up to `delaysMs.length`
 *   times. Each retry is logged at `warn` level so it's visible in CloudWatch.
 * - After exhausting all retries, the **original** error is re-thrown so
 *   Bugsnag captures the full stack trace.
 *
 * @param fn  The async function to wrap with retry logic (e.g., a DB query).
 * @param options  Optional configuration for delays, sleep, and logging.
 * @returns The result of `fn()` if it succeeds.
 * @throws The original error if retries are exhausted or the error is
 *         not a resume error.
 */
export async function withDatabaseResumeRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const delaysMs = options?.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options?.sleep ?? defaultSleep;
  const logger = options?.logger ?? console.warn;

  let firstError: unknown;

  // Try the initial call, then one retry per delay entry.
  // We make delaysMs.length + 1 total attempts (initial + N retries).
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      firstError ??= error;

      // Non-resume errors propagate immediately.
      if (!isDatabaseResumingError(error)) {
        throw error;
      }

      const delay = delaysMs[attempt];
      const retryNumber = attempt + 1;
      const maxRetries = delaysMs.length;

      logger(
        `Database is resuming, retrying in ${delay}ms ` +
          `(attempt ${retryNumber}/${maxRetries})`,
      );

      await sleep(delay);
    }
  }

  // Final attempt (no more retries left). If this also throws a
  // resume error, re-throw the first error so Bugsnag gets the
  // original stack trace.
  try {
    return await fn();
  } catch (error: unknown) {
    firstError ??= error;
    if (!isDatabaseResumingError(error)) {
      throw error;
    }
    throw firstError;
  }
}

// ── Private helpers ────────────────────────────────────────────────

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
