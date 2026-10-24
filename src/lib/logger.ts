/**
 * Structured, greppable event logs for CloudWatch Logs Insights.
 *
 * One line of JSON per event, with a stable `event` field, so
 * investigations can filter with `{ $.event = "report.submit.attempt" }`
 * and correlate front-door traffic with outcomes (validation rejections,
 * successful inserts) without scraping free-form text.
 *
 * PII rule: log shapes and identifiers (uploadId, locationId) — never
 * request bodies. Contact info must never reach the logs.
 */
export const logEvent = (
  event: string,
  data: Record<string, unknown> = {},
): void => {
  console.log(JSON.stringify({ event, ...data }));
};
