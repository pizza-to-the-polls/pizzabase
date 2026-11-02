import { Action } from "../entity/Action";
import { Order } from "../entity/Order";
import { Report } from "../entity/Report";
import { RECENT_ORDER_SKIP_WINDOW } from "../entity/constants";
import { NormalAddress } from "../lib/validator/types";
import { isGeorgiaAddress } from "../lib/validator/validateReport";

/**
 * Report auto-skip
 *
 * A fresh report is auto-skipped — pulled out of the volunteer queue — when
 * any condition holds:
 *
 *   0. georgia — the normalized address is in Georgia. SB 22 (2025) bans
 *      giving food or beverages to voters in line, so GA reports are stored
 *      but never enter the pipeline. Unconditional: runs regardless of the
 *      AUTO_SKIP_REPORTS flag and cannot be bypassed by trusted/partner
 *      auth (no submitter text — see georgiaAutoSkipDecision).
 *   1. recent_order — pizza was ordered for the location within the last
 *      RECENT_ORDER_SKIP_WINDOW (60 minutes), non-cancelled. The note tells
 *      the submitter when we ordered so they don't expect a second drop.
 *   2. line_under_an_hour — the reported line wait is under 60 minutes. We
 *      only send pizza once lines pass an hour; the note asks the submitter
 *      to resubmit if/when the line grows past one.
 *
 * The submitter note itself is assembled and sent by the ZAP_SKIP_REPORT
 * Zapier workflow (the same one manual Retool skips fire). The `autoSkip`
 * payload added there (see autoSkipPayload) carries the reason and the
 * order details so the workflow can tailor the text.
 *
 * Conditions 1 and 2 are flag-gated (AUTO_SKIP_REPORTS). Reports that
 * duplicate one already linked to an order (alreadyOrdered) and locations
 * with an active food truck are left to the normal flows.
 */
export enum AutoSkipReasons {
  recentOrder = "recent_order",
  lineUnderAnHour = "line_under_an_hour",
  /**
   * SB 22 — Georgia law bans giving food or beverages to voters waiting in
   * line, so GA reports are accepted and stored (the line data is valuable)
   * but never enter the volunteer pipeline. Unconditional: not gated by the
   * AUTO_SKIP_REPORTS flag and not bypassable by trusted/partner auth.
   */
  georgia = "georgia",
}

export const AUTO_SKIP_ACTOR = "pizza-to-the-polls";

/**
 * Feature flag — the heuristic auto-skip path (recent_order,
 * line_under_an_hour). ON by default since the enable flip (#393):
 * serverless.yml passes 'true' unless the deploy env overrides. Set
 * AUTO_SKIP_REPORTS=false (or "0") in CI env to force off per stage
 * — a redeploy, not a code change.
 *
 * Only the heuristic reasons are gated; the georgia skip is
 * unconditional compliance, not a triage heuristic.
 */
export const isAutoSkipEnabled = (): boolean => {
  const flag = (process.env.AUTO_SKIP_REPORTS || "").trim().toLowerCase();
  return !(flag === "" || flag === "false" || flag === "0");
};

export interface AutoSkipDecision {
  reason: AutoSkipReasons;
  lastOrder: Order | null;
}

// The public report form (polls.pizza form-report) radio value for
// sub-hour waits. Trusted/Retool reporters type free text, so also accept
// clearly-sub-hour minute figures ("45 min", "30-45 min"). Anything
// ambiguous — bare numbers, unfamiliar phrasings, hours — is left for a
// human.
const PUBLIC_UNDER_AN_HOUR = "less than one hour";
const MINUTES_RE = /^(\d+)\s*(?:-\s*(\d+))?\s*(?:min|mins|minutes?)\b/;

export const isLineUnderAnHour = (waitTime?: string | null): boolean => {
  if (!waitTime) return false;

  const normalized = waitTime.trim().toLowerCase();
  if (normalized === PUBLIC_UNDER_AN_HOUR) return true;

  const minutes = normalized.match(MINUTES_RE);
  if (minutes) {
    const bounds = [minutes[1], minutes[2]].filter(Boolean).map(Number);
    return Math.max(...bounds) < 60;
  }

  return false;
};

/**
 * The Georgia (SB 22) skip decision for a normalized address. Delegates to
 * isGeorgiaAddress so the state matching stays in one place; returns null
 * when the address is not in Georgia (callers fall through to the
 * flag-gated heuristics).
 */
export const georgiaAutoSkipDecision = (
  address: Pick<NormalAddress, "state">,
): AutoSkipDecision | null =>
  isGeorgiaAddress(address as NormalAddress)
    ? { reason: AutoSkipReasons.georgia, lastOrder: null }
    : null;

/**
 * Evaluate the auto-skip conditions for a freshly created report.
 * Georgia (SB 22) comes first — it is unconditional compliance and trumps
 * every heuristic. `recent_order` then takes precedence: "here's when we
 * ordered" beats the resubmit ask when both would apply.
 */
export const evaluateAutoSkip = async (
  report: Report,
): Promise<AutoSkipDecision | null> => {
  // Condition 0 — SB 22: nothing may enter the pipeline in Georgia,
  // regardless of the AUTO_SKIP_REPORTS flag.
  const georgia = georgiaAutoSkipDecision(report.location);
  if (georgia) return georgia;

  // Condition 1 — pizza already ordered for this location inside the
  // window (cancelled orders don't count: nothing is coming).
  const lastOrder = await Order.recentForLocation(
    report.location,
    RECENT_ORDER_SKIP_WINDOW,
  );
  if (lastOrder) {
    return { reason: AutoSkipReasons.recentOrder, lastOrder };
  }

  // Condition 2 — the line is under an hour, so no pizza yet.
  if (isLineUnderAnHour(report.waitTime)) {
    return { reason: AutoSkipReasons.lineUnderAnHour, lastOrder: null };
  }

  return null;
};

/**
 * Mark a report skipped and log the audit trail. Mirrors the manual Retool
 * skip (Location.skip) for a single report instead of a whole location.
 */
export const applyAutoSkip = async (
  report: Report,
  decision: AutoSkipDecision,
): Promise<Report> => {
  report.skippedAt = new Date();
  await report.save();
  await Action.log(
    report,
    `auto-skipped (${decision.reason})`,
    AUTO_SKIP_ACTOR,
  );
  return report;
};

/**
 * Extra payload riding on the ZAP_SKIP_REPORT hook so the skip Zap can pick
 * the right submitter text: when we ordered (recent_order) vs. the
 * resubmit-when-over-an-hour ask (line_under_an_hour). The Zapier
 * workflow's input schema is loose, so these keys pass harmlessly until it
 * is updated to branch on them.
 */
export const autoSkipPayload = (decision: AutoSkipDecision) => ({
  reason: decision.reason,
  lastOrder: decision.lastOrder
    ? {
        createdAt: decision.lastOrder.createdAt,
        quantity: decision.lastOrder.quantity,
        orderType: decision.lastOrder.orderType,
        restaurant: decision.lastOrder.restaurant,
      }
    : null,
});
