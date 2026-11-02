/**
 * Edge IP blocklist enforcement (FEAT-007, issue #371).
 *
 * The DB blocklist (issue #352) stores hashes only and runs inside the app
 * Lambda, so blocked traffic still consumes API Gateway + Lambda invocations.
 * A WAFv2 web ACL with an IP set associated with the prod API Gateway stage
 * drops those requests at the edge instead. This helper keeps the IP set in
 * sync with the admin-managed blocklist.
 *
 * Constraints:
 *  - Gated by WAF_BLOCKED_IPSET_ARN. Unset → the whole path is skipped
 *    (returns false, no AWS calls), so deploys without the flag are
 *    unchanged.
 *  - Best-effort: any failure is logged + Bugsnag-notified but never thrown.
 *    A WAF failure must not fail the DB block/unblock that triggered it.
 *  - The raw IP is sent to the WAFv2 API (that is the IP set's job) but is
 *    NEVER persisted in the DB (hash only) and NEVER written to app logs.
 */

import {
  GetIPSetCommand,
  UpdateIPSetCommand,
  WAFV2Client,
} from "@aws-sdk/client-wafv2";
import { normalizeIp } from "./ip-blocklist";
import { notifyBugsnag } from "./notifyBugsnag";

const SCOPE = "REGIONAL" as const;
// UpdateIPSet requires a fresh LockToken (optimistic locking). Concurrent
// block/unblock calls race on the same token, so retry with a re-fetch.
const MAX_ATTEMPTS = 3;

// Singleton, reused across invocations like the other AWS SDK clients.
let client: WAFV2Client | undefined;

const getClient = (): WAFV2Client => {
  if (!client) client = new WAFV2Client({ region: "us-west-2" });
  return client;
};

/**
 * Parse Name + Id out of a WAFv2 IP set ARN:
 *   arn:aws:wafv2:us-west-2:320802729995:regional/ipset/ptp-blocked-ips/<uuid>
 * The resource part after the final ':' is regional/ipset/<Name>/<Id>.
 */
const parseIpSetArn = (arn: string): { name: string; id: string } | null => {
  const resource = arn.split(":").pop() ?? "";
  const parts = resource.split("/");
  if (parts.length < 4 || !parts[2] || !parts[3]) return null;
  return { name: parts[2], id: parts[3] };
};

const isLockConflict = (err: unknown): boolean =>
  err instanceof Error && err.name === "WAFOptimisticLockException";

/**
 * Add or remove a raw IP (as a /32 CIDR) from the WAFv2 blocked-IP set.
 *
 * Returns true when the IP set ends up in the desired state (including when
 * it already was), false when the update was skipped (flag unset,
 * unparseable IP, malformed ARN) or failed. Never throws.
 */
export const updateWafIpSet = async (
  rawIp: string,
  action: "ADD" | "REMOVE",
): Promise<boolean> => {
  const ipSetArn = process.env.WAF_BLOCKED_IPSET_ARN || "";
  if (!ipSetArn) return false; // flag unset → skip entirely

  // Normalize with the app's own function so the CIDR matches the address
  // the hash was computed over. Unparseable input → skip (the DB side
  // rejects those with 422 before ever reaching here).
  const normalized = normalizeIp(rawIp || "");
  if (!normalized) return false;
  const cidr = `${normalized}/32`;

  const target = parseIpSetArn(ipSetArn);
  if (!target) {
    // ARN is operator-supplied config, not PII — safe to reference by env
    // var name only; never log the address itself.
    const err = new Error(
      "WAF_BLOCKED_IPSET_ARN is set but not a parseable WAFv2 IP set ARN",
    );
    console.error("waf.updateWafIpSet:", err.message);
    notifyBugsnag(err);
    return false;
  }

  try {
    const wafv2 = getClient();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Fetch a fresh LockToken + address list every attempt. Note: the
      // GetIPSet response carries LockToken at the top level, next to IPSet
      // (the IPSet itself does not expose the lock token).
      const { IPSet, LockToken } = await wafv2.send(
        new GetIPSetCommand({
          Name: target.name,
          Scope: SCOPE,
          Id: target.id,
        }),
      );

      const current = IPSet?.Addresses ?? [];
      let addresses: string[];
      if (action === "ADD") {
        if (current.includes(cidr)) return true; // already blocked at the edge
        addresses = [...current, cidr];
      } else {
        if (!current.includes(cidr)) return true; // already unblocked
        addresses = current.filter((address) => address !== cidr);
      }

      try {
        await wafv2.send(
          new UpdateIPSetCommand({
            Name: target.name,
            Scope: SCOPE,
            Id: target.id,
            LockToken: LockToken ?? "",
            Addresses: addresses,
          }),
        );
        return true;
      } catch (err) {
        if (isLockConflict(err) && attempt < MAX_ATTEMPTS) continue;
        throw err;
      }
    }
    return false;
  } catch (err) {
    // Best-effort: log + Bugsnag, never throw. The error text comes from
    // AWS and never contains the address; only the error name/message are
    // logged so the raw IP can't leak into CloudWatch.
    const name = err instanceof Error ? err.name : String(err);
    const message = err instanceof Error ? err.message : "";
    console.error(`waf.updateWafIpSet: ${action} failed: ${name}: ${message}`);
    notifyBugsnag(
      err instanceof Error ? err : new Error(`waf.updateWafIpSet: ${name}`),
    );
    return false;
  }
};
