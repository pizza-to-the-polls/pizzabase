import { Action } from "../entity/Action";
import { Order, OrderTypes } from "../entity/Order";
import { Report } from "../entity/Report";
import { Location } from "../entity/Location";
import { RECENT_ORDER_SKIP_WINDOW } from "../entity/constants";
import {
  AutoSkipReasons,
  applyAutoSkip,
  autoSkipPayload,
  evaluateAutoSkip,
  isAutoSkipEnabled,
  isLineUnderAnHour,
} from "./auto-skip";

const TEST_ADDRESS = {
  latitude: 41.79907,
  longitude: -87.58413,
  fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
  address: "5335 S Kimbark Ave",
  city: "Chicago",
  state: "IL",
  zip: "60615",
};

describe("isAutoSkipEnabled", () => {
  const original = process.env.AUTO_SKIP_REPORTS;

  afterEach(() => {
    // Suites share one Node process (maxWorkers: 1) — restore, never leak.
    if (original === undefined) {
      delete process.env.AUTO_SKIP_REPORTS;
    } else {
      process.env.AUTO_SKIP_REPORTS = original;
    }
  });

  test.each([
    [undefined, false], // unset — default off, volunteer triage as before
    ["", false], // empty (serverless.yml passes '' when unset)
    ["false", false],
    ["0", false],
    ["FALSE", false],
    ["true", true],
    ["1", true],
    ["yes", true],
  ])("AUTO_SKIP_REPORTS=%s → %s", (value, expected) => {
    if (value === undefined) {
      delete process.env.AUTO_SKIP_REPORTS;
    } else {
      process.env.AUTO_SKIP_REPORTS = value as string;
    }
    expect(isAutoSkipEnabled()).toBe(expected);
  });
});

describe("isLineUnderAnHour", () => {
  test.each([
    ["Less than one hour", true], // public form radio value (polls.pizza)
    ["less than one hour", true], // case-insensitive
    ["  less than one hour  ", true], // whitespace-tolerant
    ["45 min", true], // trusted free text
    ["30-45 min", true], // range: upper bound still under an hour
    ["59 minutes", true],
    ["1-2 hours", false], // public form radio values
    ["2-3 hours", false],
    ["3+ hours", false],
    ["60 min", false], // exactly an hour is NOT under an hour
    ["30-90 min", false], // range crossing an hour
    ["5000", false], // bare number, no unit — ambiguous, human decides
    ["45", false],
    ["over an hour", false],
    ["", false],
    [undefined, false],
    [null, false],
  ])("%s → %s", (waitTime, expected) => {
    expect(isLineUnderAnHour(waitTime as string | null | undefined)).toBe(
      expected,
    );
  });
});

describe("evaluateAutoSkip", () => {
  const newReportAt = async (address = TEST_ADDRESS) =>
    Report.createNewReport(
      "+15550000001",
      `http://twitter.com/status/auto-skip-${Math.random()}`,
      address,
      { waitTime: "1-2 hours" },
    );

  test("no order, 1+ hour line → no auto-skip", async () => {
    const [report] = await newReportAt();
    expect(await evaluateAutoSkip(report)).toBeNull();
  });

  test("order within the window → recent_order, most recent order wins", async () => {
    const location = await Location.createFromAddress({
      ...TEST_ADDRESS,
      fullAddress: "9 Window Way Chicago IL 60615",
      address: "9 Window Way",
    });
    await Order.placeOrder({ cost: 40, quantity: 4 }, location);
    await Order.placeOrder(
      { cost: 50, quantity: 5, restaurant: "Giordano's" },
      location,
    );

    const [report] = await newReportAt({
      ...TEST_ADDRESS,
      fullAddress: "9 Window Way Chicago IL 60615",
      address: "9 Window Way",
    });

    const decision = await evaluateAutoSkip(report);
    expect(decision?.reason).toEqual(AutoSkipReasons.recentOrder);
    expect(decision?.lastOrder?.restaurant).toEqual("Giordano's");
  });

  test("recent_order takes precedence over line_under_an_hour", async () => {
    const location = await Location.createFromAddress({
      ...TEST_ADDRESS,
      fullAddress: "10 Precedence Pl Chicago IL 60615",
      address: "10 Precedence Pl",
    });
    await Order.placeOrder({ cost: 40, quantity: 4 }, location);

    const [report] = await Report.createNewReport(
      "+15550000002",
      `http://twitter.com/status/precedence-${Math.random()}`,
      {
        ...TEST_ADDRESS,
        fullAddress: "10 Precedence Pl Chicago IL 60615",
        address: "10 Precedence Pl",
      },
      { waitTime: "Less than one hour" },
    );

    const decision = await evaluateAutoSkip(report);
    expect(decision?.reason).toEqual(AutoSkipReasons.recentOrder);
  });

  test("order outside the window no longer auto-skips", async () => {
    const location = await Location.createFromAddress({
      ...TEST_ADDRESS,
      fullAddress: "11 Stale Order St Chicago IL 60615",
      address: "11 Stale Order St",
    });
    const order = await Order.placeOrder({ cost: 40, quantity: 4 }, location);
    // Backdate past the 60-minute window (query-builder so the column
    // itself moves, not just the in-memory entity).
    await Order.createQueryBuilder()
      .update()
      .set({
        createdAt: new Date(Date.now() - 2 * RECENT_ORDER_SKIP_WINDOW),
      } as any)
      .where("id = :id", { id: order.id })
      .execute();

    const [report] = await Report.createNewReport(
      "+15550000003",
      `http://twitter.com/status/stale-${Math.random()}`,
      {
        ...TEST_ADDRESS,
        fullAddress: "11 Stale Order St Chicago IL 60615",
        address: "11 Stale Order St",
      },
      { waitTime: "1-2 hours" },
    );

    expect(await evaluateAutoSkip(report)).toBeNull();
  });

  test("cancelled recent order does not auto-skip", async () => {
    const location = await Location.createFromAddress({
      ...TEST_ADDRESS,
      fullAddress: "12 Cancelled Ct Chicago IL 60615",
      address: "12 Cancelled Ct",
    });
    const order = await Order.placeOrder({ cost: 40, quantity: 4 }, location);
    await order.cancelAndZero();

    const [report] = await Report.createNewReport(
      "+15550000004",
      `http://twitter.com/status/cancelled-${Math.random()}`,
      {
        ...TEST_ADDRESS,
        fullAddress: "12 Cancelled Ct Chicago IL 60615",
        address: "12 Cancelled Ct",
      },
      { waitTime: "1-2 hours" },
    );

    expect(await evaluateAutoSkip(report)).toBeNull();
  });

  test("sub-hour line with no order → line_under_an_hour", async () => {
    const [report] = await Report.createNewReport(
      "+15550000005",
      `http://twitter.com/status/short-line-${Math.random()}`,
      TEST_ADDRESS,
      { waitTime: "Less than one hour" },
    );

    const decision = await evaluateAutoSkip(report);
    expect(decision?.reason).toEqual(AutoSkipReasons.lineUnderAnHour);
    expect(decision?.lastOrder).toBeNull();
  });
});

describe("applyAutoSkip", () => {
  test("marks skippedAt and logs the action", async () => {
    const [report] = await Report.createNewReport(
      "+15550000006",
      `http://twitter.com/status/apply-${Math.random()}`,
      TEST_ADDRESS,
      { waitTime: "Less than one hour" },
    );

    await applyAutoSkip(report, {
      reason: AutoSkipReasons.lineUnderAnHour,
      lastOrder: null,
    });

    const skipped = await Report.findOne({ where: { id: report.id } });
    expect(skipped?.skippedAt).toBeTruthy();

    const action = await Action.findOne({
      where: {
        entityId: report.id,
        entityType: "Report",
      },
    });
    expect(action?.actionType).toEqual(
      `auto-skipped (${AutoSkipReasons.lineUnderAnHour})`,
    );
  });
});

describe("autoSkipPayload", () => {
  test("carries the order details for the skip Zap's submitter text", async () => {
    const location = await Location.createFromAddress({
      ...TEST_ADDRESS,
      fullAddress: "13 Payload Pkwy Chicago IL 60615",
      address: "13 Payload Pkwy",
    });
    const order = await Order.placeOrder(
      {
        cost: 40,
        quantity: 4,
        orderType: OrderTypes.pizzas,
        restaurant: "Lou Malnati's",
      },
      location,
    );

    const payload = autoSkipPayload({
      reason: AutoSkipReasons.recentOrder,
      lastOrder: order,
    });

    expect(payload).toEqual({
      reason: "recent_order",
      lastOrder: {
        createdAt: order.createdAt,
        quantity: order.quantity,
        orderType: order.orderType,
        restaurant: order.restaurant,
      },
    });
  });

  test("line_under_an_hour has no lastOrder", () => {
    expect(
      autoSkipPayload({
        reason: AutoSkipReasons.lineUnderAnHour,
        lastOrder: null,
      }),
    ).toEqual({ reason: "line_under_an_hour", lastOrder: null });
  });
});
