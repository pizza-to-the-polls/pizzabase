/**
 * Retry helper for Aurora Serverless v1 auto-pause resume errors and
 * RDS Data API 5xx failures.
 *
 * Two failure modes are handled:
 *
 * 1. **Resume errors** — Aurora Serverless v1 auto-pauses after periods of
 *    inactivity and takes several seconds to resume. During the resume
 *    window, every query via the RDS Data API throws a BadRequestException
 *    with the message:
 *
 *      "The Aurora DB instance db-XXX is resuming after being auto-paused.
 *       Please wait a few seconds and try again."
 *
 *    These are retried with flat-then-exponential backoff covering the
 *    typical ~5s (and rare ~25s) resume window.
 *
 * 2. **Data API 5xx errors** — the Data API does not always fail fast with
 *    the resume error above. Sometimes the request hangs server-side for
 *    ~10–14s and then returns an opaque HTTP 500
 *    (`InternalServerErrorException`, message `UnknownError`). The bundled
 *    AWS SDK v3 client has already retried 3 times internally (~30s) by the
 *    time the error reaches this module, and the DB resume has usually
 *    completed — so these use a short retry schedule.
 *
 *    **Idempotency note:** a 500 after a long hang is ambiguous — the
 *    statement *may* have executed before the failure. When the query text
 *    is known (via `options.queryText`), only idempotent read-only
 *    statements (SELECT/WITH) are auto-retried on 5xx; writes propagate
 *    immediately to avoid duplicate writes. Without query text (e.g.
 *    transaction commands, which are idempotent server-side state
 *    transitions), 5xx is retried as the safer default — the alternative
 *    is a guaranteed 500 for every request in the window. "Resuming"
 *    errors are always retried because a paused DB rejects the request
 *    before it executes anything.
 *
 * All delays and dependencies are injectable so the logic is fully
 * unit-testable without real timers or DB connections.
 */

// ── Constants ──────────────────────────────────────────────────────

/** Substring that uniquely identifies an Aurora Serverless resume error. */
export const DATABASE_RESUMING_MESSAGE = "resuming after being auto-paused";

/**
 * Default backoff delays in milliseconds for "resuming" errors.
 *
 * Strategy: flat then stair-stepped to stay under the 30s Lambda timeout
 * while covering Aurora Serverless v1 resume times (up to ~25s).
 *   - First 5 retries: 1s each (covers the typical ~5s resume window)
 *   - Next 3: 2s each (slower wake-up)
 *   - Next 3: 3s each (rare slow resume)
 *   - Final: 4s (worst-case tail)
 *   - 12 retries total, ~21s total sleep time
 *
 * With ~5s of execution overhead the worst-case path finishes under
 * the 30s Lambda timeout.
 */
export const DEFAULT_RETRY_DELAYS_MS = [
  1000, 1000, 1000, 1000, 1000, 2000, 2000, 2000, 3000, 3000, 3000, 4000,
];

/**
 * Short backoff schedule for RDS Data API 5xx errors (3 retries, ~11s total).
 *
 * The bundled AWS SDK v3 client already retried the request 3 times
 * internally (~30s) before surfacing the 500, so by the time it reaches
 * this module the DB resume has usually completed — a quick retry should
 * succeed. The short schedule also keeps the total added sleep well under
 * the app function's 120s timeout, since more queries usually follow in
 * the same request.
 */
export const DATA_API_5XX_DELAYS_MS = [1000, 2000, 4000, 4000];

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

/**
 * Returns `true` if `error` is an RDS Data API 5xx server error.
 *
 * Detection is by `error.name` / `error.$metadata.httpStatusCode` rather
 * than `instanceof`: the `InternalServerErrorException` class is bundled
 * inside the typeorm-aurora-data-api-driver UMD bundle, so an instanceof
 * check against classes in our own module graph can never match it.
 */
function is5xxServiceError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  if (candidate.name === "InternalServerErrorException") return true;
  const status = candidate.$metadata?.httpStatusCode;
  return typeof status === "number" && status >= 500;
}

/**
 * Returns `true` if `error` should be retried by `withDatabaseResumeRetry`.
 *
 * Retryable:
 *   - Aurora "resuming after being auto-paused" errors (always), AND
 *   - RDS Data API 5xx errors (`InternalServerErrorException` / HTTP 500
 *     `UnknownError`), subject to the idempotency guard below.
 *
 * The 5xx idempotency guard: when `queryText` is provided, only read-only
 * statements (`SELECT` / `WITH`) are auto-retried on 5xx — a 500 after a
 * long server-side hang is ambiguous, so write statements propagate
 * immediately to avoid duplicate writes. When `queryText` is not provided
 * (transaction commands, callers without the SQL text), 5xx is retried as
 * the safer default.
 *
 * Everything else (constraint violations, SQL syntax errors, network
 * errors without a 5xx status, …) is **not** retryable and propagates
 * immediately.
 */
export function isRetryableDataApiError(
  error: unknown,
  queryText?: string,
): boolean {
  // Resume errors are always retryable: a paused DB rejects the request
  // outright, so nothing can have executed.
  if (isDatabaseResumingError(error)) return true;

  if (!is5xxServiceError(error)) return false;

  if (queryText != null) {
    // Idempotency guard: only retry read-only statements on 5xx.
    // Note: a `WITH ... INSERT` CTE would be treated as a read here —
    // in this codebase CTE-writes are rare, the resume window is short,
    // and the alternative is a guaranteed 500, so this tradeoff is
    // acceptable.
    const firstWord = queryText.trimStart().split(/\s/, 1)[0]?.toUpperCase();
    return firstWord === "SELECT" || firstWord === "WITH";
  }

  // No query text available (transaction BEGIN/COMMIT/ROLLBACK, callers
  // that don't know the SQL) — retry as the safer default.
  return true;
}

// ── Retry options ─────────────────────────────────────────────────

export interface RetryOptions {
  /**
   * Delays between retries in milliseconds.
   *
   * When omitted, the schedule is picked from the first error:
   * `DEFAULT_RETRY_DELAYS_MS` for resume errors, `DATA_API_5XX_DELAYS_MS`
   * for Data API 5xx errors. An explicit value always wins.
   *
   * @default Depends on the first error's classification (see above)
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

  /**
   * The SQL text of the query being retried, when known. Enables the 5xx
   * idempotency guard in `isRetryableDataApiError`: only SELECT/WITH
   * statements are auto-retried on Data API 5xx errors.
   *
   * @default undefined — 5xx errors are retried (safer default for
   * transaction commands and callers without the SQL text)
   */
  queryText?: string;
}

// ── Core retry logic ───────────────────────────────────────────────

/**
 * Executes `fn`, retrying two classes of Aurora Serverless v1 failures:
 *
 * - **"resuming after being auto-paused" errors** — retried with
 *   flat-then-exponential backoff (see `DEFAULT_RETRY_DELAYS_MS`).
 * - **RDS Data API 5xx errors** (`InternalServerErrorException` /
 *   HTTP 500 `UnknownError`) — retried with a short schedule
 *   (see `DATA_API_5XX_DELAYS_MS`) because the bundled AWS SDK has already
 *   spent ~30s retrying internally. Subject to the idempotency guard in
 *   `isRetryableDataApiError` when `options.queryText` is provided.
 *
 * **Key behaviors:**
 * - If `fn()` succeeds on the first call, the result is returned immediately
 *   (zero added latency during normal operation).
 * - If `fn()` throws a **non-retryable** error, it propagates immediately —
 *   no retries for unrelated failures (SQL syntax errors, constraint
 *   violations, 4xx errors, etc.).
 * - The delay schedule is chosen from the **first** error; later errors do
 *   not switch the schedule mid-flight (in practice all errors within one
 *   failure burst are of the same kind).
 * - Each retry is logged at `warn` level (including
 *   `error.$metadata.httpStatusCode` / `requestId` when present) so it's
 *   visible and diagnosable in CloudWatch alone.
 * - After exhausting all retries, the **original** error is re-thrown so
 *   Bugsnag captures the full stack trace.
 *
 * @param fn  The async function to wrap with retry logic (e.g., a DB query).
 * @param options  Optional configuration for delays, sleep, logging, and
 *        the query text used by the 5xx idempotency guard.
 * @returns The result of `fn()` if it succeeds.
 * @throws The original error if retries are exhausted or the error is
 *         not retryable.
 */
export async function withDatabaseResumeRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const sleep = options?.sleep ?? defaultSleep;
  const logger = options?.logger ?? console.warn;
  const queryText = options?.queryText;
  const explicitDelays = options?.delaysMs;

  // Schedule is picked from the first error; an explicit delaysMs always
  // wins. See the doc comment above for the rationale.
  let delaysMs = explicitDelays ?? DEFAULT_RETRY_DELAYS_MS;

  let firstError: unknown;
  let haveFirstError = false;

  // Try the initial call, then one retry per delay entry.
  // We make delaysMs.length + 1 total attempts (initial + N retries).
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (!haveFirstError) {
        haveFirstError = true;
        firstError = error;
        if (
          explicitDelays === undefined &&
          !isDatabaseResumingError(error) &&
          is5xxServiceError(error)
        ) {
          delaysMs = DATA_API_5XX_DELAYS_MS;
        }
      }

      // Non-retryable errors propagate immediately.
      if (!isRetryableDataApiError(error, queryText)) {
        throw error;
      }

      const delay = delaysMs[attempt];
      const retryNumber = attempt + 1;
      const maxRetries = delaysMs.length;

      logger(
        `${retryLogPrefix(error)}, retrying in ${delay}ms ` +
          `(attempt ${retryNumber}/${maxRetries})${metadataSuffix(error)}`,
      );

      await sleep(delay);
    }
  }

  // Final attempt (no more retries left). If this also throws a
  // retryable error, re-throw the first error so Bugsnag gets the
  // original stack trace.
  try {
    return await fn();
  } catch (error: unknown) {
    if (!haveFirstError) {
      firstError = error;
    }
    if (!isRetryableDataApiError(error, queryText)) {
      throw error;
    }
    throw firstError;
  }
}

// ── Private helpers ────────────────────────────────────────────────

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Log prefix describing the kind of retryable error being handled. */
function retryLogPrefix(error: unknown): string {
  return isDatabaseResumingError(error)
    ? "Database is resuming"
    : "RDS Data API returned a 5xx error";
}

/**
 * Builds a ` [status=..., requestId=...]` suffix from `error.$metadata`
 * (omitted when neither field is present) so retries are diagnosable
 * from CloudWatch alone.
 */
function metadataSuffix(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const metadata = (
    error as {
      $metadata?: { httpStatusCode?: unknown; requestId?: unknown };
    }
  ).$metadata;
  const parts: string[] = [];
  if (metadata?.httpStatusCode != null) {
    parts.push(`status=${String(metadata.httpStatusCode)}`);
  }
  if (metadata?.requestId != null) {
    parts.push(`requestId=${String(metadata.requestId)}`);
  }
  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}
