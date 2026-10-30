import { pack, unpack } from "./jwt";

/**
 * Trusted partner-report access (staging rollout, 2026-10-30).
 *
 * Hardcoded allowlist per the staging plan: Scott, Nina, Lee. When this
 * graduates to real partner orgs (CA Election Protection network etc.),
 * move the allowlist to a `partners` table managed via the Pizza Eagle
 * Slack command and keep these functions as the only touch points.
 */
export const PARTNER_EMAILS = [
  "scott@polls.pizza",
  "nina@polls.pizza",
  "lee.kornfeld@gmail.com",
] as readonly string[];

// Partner sessions outlive the Crust Club default (15 min) so a partner
// can request one magic link and file several reports through a shift
// without re-authenticating mid-entry.
export const PARTNER_SESSION_TTL_SECONDS = 60 * 60 * 24;
export const PARTNER_SESSION_SCOPE = "partner-report";

export const normalizeEmail = (email?: string): string =>
  (email || "").trim().toLowerCase();

export const isPartnerEmail = (email?: string): boolean =>
  (PARTNER_EMAILS as readonly string[]).includes(normalizeEmail(email));

/** Mint a partner session token (URL-safe, `|`-encoded like other JWTs). */
export const packPartnerSession = async (email: string): Promise<string> =>
  await pack(
    { partner: normalizeEmail(email), scope: PARTNER_SESSION_SCOPE },
    PARTNER_SESSION_TTL_SECONDS,
  );

/**
 * Verify a partner session token. Returns the partner email, or null when
 * the token is missing/expired/wrong-scope or the email is no longer
 * allowlisted (removal from the list revokes live sessions immediately).
 *
 * Tolerates URL-encoded tokens (`%7C` where a `|` belongs): links pass
 * through email clients and query parsers that encode the pipe, and a
 * double-encoded or undecoded token must still verify.
 */
export const unpackPartnerSession = async (
  token?: string,
): Promise<string | null> => {
  try {
    let candidate = `${token || ""}`;
    try {
      candidate = decodeURIComponent(candidate);
    } catch (_e) {
      // Stray `%` — keep the raw string; unpack will reject it if invalid.
    }
    const payload = await unpack(candidate.replace(/%7C/gi, "|"));
    if (payload?.scope !== PARTNER_SESSION_SCOPE) return null;
    const email = normalizeEmail(payload?.partner);
    return isPartnerEmail(email) ? email : null;
  } catch (_e) {
    return null;
  }
};
