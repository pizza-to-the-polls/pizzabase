import { pack, unpack } from "./jwt";
import { User } from "../entity/User";

/**
 * Trusted partner-report access, backed by the users table (2026-10-31 —
 * was a hardcoded staging allowlist). Users are managed via the
 * API-key-protected CRUD endpoints (UsersController) so Pizza Eagle can
 * add people on request (Lee/Nina/Scott ask in Slack → pizza-eagle POSTs).
 *
 * Any user row can JWT in to the partner form; `admin` marks team members.
 * Deleting a user revokes their live sessions on the next submit
 * (unpackPartnerSession re-checks the table every time).
 */

// Partner sessions outlive the Crust Club default (15 min) so a partner
// can request one magic link and file several reports through a shift
// without re-authenticating mid-entry.
export const PARTNER_SESSION_TTL_SECONDS = 60 * 60 * 24;
export const PARTNER_SESSION_SCOPE = "partner-report";

export const normalizeEmail = (email?: string): string =>
  (email || "").trim().toLowerCase();

/**
 * Resolve a partner login to a known user. Null when the email isn't on
 * the users table (unknown, removed, or never existed).
 */
export const findPartnerUser = (email?: string): Promise<User | null> =>
  User.findUserByEmail(email);

/** Mint a partner session token (URL-safe, `|`-encoded like other JWTs). */
export const packPartnerSession = async (email: string): Promise<string> =>
  await pack(
    { partner: normalizeEmail(email), scope: PARTNER_SESSION_SCOPE },
    PARTNER_SESSION_TTL_SECONDS,
  );

/**
 * Verify a partner session token. Returns the partner User, or null when
 * the token is missing/expired/wrong-scope or the user no longer exists
 * (deleting the row revokes live sessions immediately).
 *
 * Tolerates URL-encoded tokens (`%7C` where a `|` belongs): links pass
 * through email clients and query parsers that encode the pipe, and a
 * double-encoded or undecoded token must still verify.
 */
export const unpackPartnerSession = async (
  token?: string,
): Promise<User | null> => {
  try {
    let candidate = `${token || ""}`;
    try {
      candidate = decodeURIComponent(candidate);
    } catch (_e) {
      // Stray `%` — keep the raw string; unpack will reject it if invalid.
    }
    const payload = await unpack(candidate.replace(/%7C/gi, "|"));
    if (payload?.scope !== PARTNER_SESSION_SCOPE) return null;
    return await findPartnerUser(normalizeEmail(payload?.partner));
  } catch (_e) {
    return null;
  }
};
