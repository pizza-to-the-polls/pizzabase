import crypto from "crypto";

/**
 * Twilio webhook request validation (MMS-002).
 *
 * Implements the algorithm documented at
 * https://www.twilio.com/docs/usage/security#validating-requests:
 *
 * 1. Take the full request URL (scheme, host, path, and any query string) —
 *    the caller supplies this verbatim; this module never reconstructs it.
 *    The caller (MMS-003) must build it exactly as Twilio did, e.g.
 *    `req.protocol + "://" + req.get("host") + req.originalUrl`.
 * 2. Sort the POST parameters alphabetically by key.
 * 3. Concatenate the URL + each `key + value` pair in sorted-key order.
 *    Multi-value keys (duplicate form fields) are concatenated once per
 *    element, with values **sorted and then de-duplicated** — matching
 *    Twilio's official client libraries (verified against the Python SDK's
 *    RequestValidator unit tests, which pin this behavior).
 * 4. HMAC-SHA1 the result with the account auth token, base64-encode the
 *    digest, and compare against the `X-Twilio-Signature` header using a
 *    constant-time comparison.
 *
 * Deliberately NOT implemented: the legacy "skip body params when the URL
 * query string contains `body=`" quirk from Twilio's client libraries
 * (an old Rails-era workaround). The webhook controller always passes the
 * real URL plus the parsed form body, so the quirk can never trigger.
 */

const TWILIO_AUTH_TOKEN_ENV = "TWILIO_AUTH_TOKEN";

// HMAC-SHA1 digests are 20 bytes → 27 base64 data chars + one '=' (28 total).
// Buffer.from(s, "base64") never throws — it silently skips invalid chars —
// so an explicit strict gate is required to catch malformed signatures.
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Whether a Twilio auth token is configured in the environment.
 *
 * The webhook controller should log a clear warning when this returns
 * false, since every incoming request will then fail validation.
 */
export function isTwilioSignatureConfigured(): boolean {
  return Boolean(process.env[TWILIO_AUTH_TOKEN_ENV]);
}

/**
 * Build the signature base string: full URL followed by each
 * `key + value` pair, sorted alphabetically by key. Duplicate keys
 * (parsed form arrays) have their values sorted and de-duplicated,
 * matching Twilio's official client libraries (verified against the
 * Python SDK's RequestValidator unit tests). A shallow copy is sorted
 * so the caller's array is never mutated.
 */
function buildSignatureBase(url: string, body: Record<string, any>): string {
  const params = body ?? {};
  return Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      const value = params[key];
      if (Array.isArray(value)) {
        const sorted = value
          .map(String)
          .slice()
          .sort()
          .filter((v, i, sortedValues) => i === 0 || v !== sortedValues[i - 1]);
        return sorted.reduce((inner, v) => inner + key + v, acc);
      }
      return acc + key + String(value);
    }, url);
}

/**
 * Verify an inbound Twilio webhook request's `X-Twilio-Signature` header.
 *
 * Returns false (never throws) when the header is missing, the auth token
 * is not configured (and not overridden), or the signature is malformed.
 *
 * @param params.url       Full request URL including query string
 * @param params.body      Parsed form parameters (values are strings, or
 *                         string arrays for repeated form fields)
 * @param params.signature The X-Twilio-Signature header value (or null)
 * @param params.authToken Optional token override for tests; defaults to
 *                         process.env.TWILIO_AUTH_TOKEN
 */
export function verifyTwilioSignature(params: {
  url: string;
  body: Record<string, any>;
  signature: string | null;
  authToken?: string;
}): boolean {
  const { url, body, signature } = params;
  if (!signature) return false;

  const authToken = params.authToken ?? process.env[TWILIO_AUTH_TOKEN_ENV];
  if (!authToken) return false;

  if (!BASE64_RE.test(signature) || signature.length % 4 !== 0) return false;

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(buildSignatureBase(url, body))
    .digest();
  const provided = Buffer.from(signature, "base64");

  // timingSafeEqual throws on unequal buffer lengths — pre-guard so a
  // truncated/garbage signature returns false instead of throwing.
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}
