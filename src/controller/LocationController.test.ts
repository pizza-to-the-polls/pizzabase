import * as http_mocks from "node-mocks-http";

import { LocationController } from "./LocationController";
import { Location } from "../entity/Location";
import { Action } from "../entity/Action";
import { Order } from "../entity/Order";
import { Report } from "../entity/Report";

jest.mock("node-fetch");
jest.mock("../lib/validator/normalizeAddress");

import fetch from "node-fetch";

let location: Location | null;

beforeEach(async () => {
  location = await Location.createFromAddress({
    latitude: 41.79907,
    longitude: -87.58413,

    fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

    address: "5335 S Kimbark Ave",
    city: "Chicago",
    state: "IL",
    zip: "60615",
  });
});

describe("#all", () => {
  test("Lists the locations", async () => {
    const controller = new LocationController();

    const body = await controller.all(
      http_mocks.createRequest(),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual(await Location.find());
  });
});

describe("#one", () => {
  test("Tries to get a null location", async () => {
    const controller = new LocationController();

    const response = http_mocks.createResponse();

    const body = await controller.one(
      http_mocks.createRequest({ params: { idOrAddress: `not-real` } }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(404);
    expect(body).toBeFalsy();
  });

  test("Gets a location with an ID, returns orders and reports", async () => {
    const controller = new LocationController();

    const { id, fullAddress } = location ? location : null;

    const [report] = await Report.createNewReport(
      "333-234-2345",
      "http://twitter.com/what",
      {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress,

        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zip: "60615",
      }
    );
    const order = await Order.placeOrder({ pizzas: 1, cost: 5 }, location);

    const body = await controller.one(
      http_mocks.createRequest({ params: { idOrAddress: `${id}` } }),
      http_mocks.createResponse(),
      () => undefined
    );

    await report.reload();
    await order.reload();

    expect(body).toEqual({
      ...location,
      orders: [order.asJSON()],
      reports: [report.asJSON()],
    });
  });

  test("Gets a location with a + encoded address", async () => {
    const controller = new LocationController();

    const { fullAddress } = location ? location : null;

    const body = await controller.one(
      http_mocks.createRequest({
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({ ...location, reports: [], orders: [] });
  });

  test("Gets a location with a space encoded address", async () => {
    const controller = new LocationController();

    const { fullAddress } = location ? location : null;

    const body = await controller.one(
      http_mocks.createRequest({
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({ ...location, reports: [], orders: [] });
  });
});

describe("#validate", () => {
  it("validates a location and logs the username", async () => {
    const user = "jimmy";

    const { fullAddress, id, validatedAt } = location ? location : null;
    expect(validatedAt).toBeNull();

    const controller = new LocationController();
    await controller.validate(
      http_mocks.createRequest({
        method: "PUT",
        body: { user },
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    await location.reload();
    expect(location.validatedAt).toBeTruthy();

    const action = await Action.findOne({
      where: { entityId: id, entityType: location.constructor.name },
    });
    expect(action.user).toEqual(user);
  });

  it("validates a location even without a username", async () => {
    const { fullAddress, id } = location ? location : null;

    const controller = new LocationController();
    await controller.validate(
      http_mocks.createRequest({
        method: "PUT",
        body: {},
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    await location.reload();
    expect(location.validatedAt).toBeTruthy();

    const action = await Action.findOne({
      where: { entityId: id, entityType: location.constructor.name },
    });
    expect(action.user).toEqual("not specified");
  });

  it("return 401 status if bad api key", async () => {
    const { fullAddress } = location ? location : null;

    const response = http_mocks.createResponse();
    const controller = new LocationController();
    const body = await controller.validate(
      http_mocks.createRequest({
        method: "PUT",
        body: {},
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic badapikey` },
      }),
      response,
      () => undefined
    );
    expect(body).toBeFalsy();
    expect(response.statusCode).toEqual(401);
  });

  it("validates and submits all open reports with unique urls", async () => {
    const { fullAddress } = location ? location : null;

    const [ordered] = await Report.createNewReport(
      "333-234-2345",
      "http://twitter.com/what",
      {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress,

        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zip: "60615",
      }
    );

    await Order.placeOrder({ pizzas: 1, cost: 5 }, ordered.location);

    const [report] = await Report.createNewReport(
      "222-234-2345",
      "http://insta.com/what",
      {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress,

        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zip: "60615",
      }
    );

    // Will skip the duplicate url report
    await Report.createNewReport("555-234-2345", "http://insta.com/what", {
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress,

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });

    await new LocationController().validate(
      http_mocks.createRequest({
        method: "PUT",
        body: {},
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    await report.reload();

    const [url, { body }] = fetch.mock.calls[0];
    expect(url).toEqual(process.env.ZAP_NEW_REPORT);
    expect(body).toEqual(
      JSON.stringify({
        report: report.asJSON(),
        location: report.location.asJSON(),
      })
    );
  });
});

describe("#skip", () => {
  it("skip a location, skips all reports, and logs the username", async () => {
    const { fullAddress, id, validatedAt } = location ? location : null;
    expect(validatedAt).toBeNull();

    const [ordered] = await Report.createNewReport(
      "222-234-2345",
      "http://insta.com/what",
      {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress,

        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zip: "60615",
      }
    );

    await Order.placeOrder({ pizzas: 1, cost: 5 }, ordered.location);

    const [pending] = await Report.createNewReport(
      "222-234-2345",
      "http://twitter.com/what",
      {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress,

        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zip: "60615",
      }
    );

    const controller = new LocationController();
    await controller.skip(
      http_mocks.createRequest({
        method: "PUT",
        body: { user: "jimmy" },
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    await location.reload();

    const { user, actionType } = await Action.findOne({
      where: { entityId: id, entityType: location.constructor.name },
    });
    expect(user).toEqual("jimmy");
    expect(actionType).toEqual("skipped");

    await pending.reload();
    expect(pending.skippedAt).toBeTruthy();
    await ordered.reload();
    expect(ordered.skippedAt).toBeFalsy();
  });
});

describe("#order", () => {
  it("returns validation errors", async () => {
    const { fullAddress } = location ? location : null;

    const controller = new LocationController();
    const response = http_mocks.createResponse();
    const body = await controller.order(
      http_mocks.createRequest({
        method: "PUT",
        body: {},
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined
    );
    expect(body).toEqual({
      errors: {
        cost: "Invalid Cost - please supply a cost of the order",
      },
    });
    expect(response.statusCode).toEqual(422);
  });

  it("can create an order only with costs", async () => {
    const { fullAddress } = location ? location : null;

    const controller = new LocationController();
    await controller.order(
      http_mocks.createRequest({
        method: "PUT",
        body: { cost: "$500.23423" },
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    const [order] = await location.orders;

    expect(order.cost).toEqual(500.23);
    expect(order.pizzas).toEqual(32);
  });

  it("validates the order too", async () => {
    const { fullAddress } = location ? location : null;

    const controller = new LocationController();
    await controller.order(
      http_mocks.createRequest({
        method: "PUT",
        body: { cost: "$500.23423" },
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    await location.reload();
    expect(location.validatedAt).toBeTruthy();
  });

  it("creates an order for all non-skipped reports", async () => {
    const { fullAddress } = location ? location : null;

    const [ordered] = await Report.createNewReport(
      "222-234-2345",
      "http://insta.com/what",
      {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress,

        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zip: "60615",
      }
    );

    await Order.placeOrder({ pizzas: 1, cost: 5 }, ordered.location);

    const [skipped] = await Report.createNewReport(
      "222-234-2345",
      "http://insta.com/different",
      {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress,

        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zip: "60615",
      }
    );
    skipped.skippedAt = new Date();
    await skipped.save();

    const [pending] = await Report.createNewReport(
      "222-234-2345",
      "http://twitter.com/also-different",
      {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress,

        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zip: "60615",
      }
    );

    const controller = new LocationController();
    const response = http_mocks.createResponse();
    const body = await controller.order(
      http_mocks.createRequest({
        method: "PUT",
        body: {
          pizzas: "5",
          cost: "$55.239",
          restaurant: "mario's house",
          user: "jim",
        },
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined
    );
    expect(body).toEqual({ success: true });
    expect(response.statusCode).toEqual(200);

    await pending.reload();
    const order = pending.order;
    expect(order).toBeTruthy();

    expect(order.cost).toEqual(55.24);
    expect(order.pizzas).toEqual(5);
    expect(order.restaurant).toEqual("mario's house");

    const { user, actionType } = await Action.findOne({
      where: { entityId: order.id, entityType: order.constructor.name },
    });
    expect(user).toEqual("jim");
    expect(actionType).toEqual("ordered");

    await ordered.reload();
    expect(order).not.toEqual(ordered.order);

    await skipped.reload();
    expect(skipped.order).toBeFalsy();
  });
});
