import * as http_mocks from "node-mocks-http";

import { LocationsController } from "./LocationsController";
import { Location } from "../entity/Location";
import { Action } from "../entity/Action";
import { Order } from "../entity/Order";
import { Report } from "../entity/Report";
import { COST_ERROR } from "../lib/validator/constants";

jest.mock("node-fetch");
jest.mock("../lib/validator/geocode");

import fetch from "node-fetch";

let location: Location | null;
const controller = new LocationsController();

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

describe("#index", () => {
  test("Lists the locations", async () => {
    const body = await controller.index(
      http_mocks.createRequest(),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({
      results: await Promise.all(
        (await Location.find()).map(async (loc) => await loc.asJSON())
      ),
      count: 1,
    });
  });
});

describe("#show", () => {
  test("Tries to get a null location", async () => {
    const response = http_mocks.createResponse();

    const body = await controller.show(
      http_mocks.createRequest({ params: { idOrAddress: `not-real` } }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(404);
    expect(body).toBeFalsy();
  });

  test("Gets a location with an ID, returns orders and reports", async () => {
    const { id, fullAddress } = location ? location : null;

    const order = await Order.placeOrder({ quantity: 1, cost: 5 }, location);

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
    const body = await controller.show(
      http_mocks.createRequest({ params: { idOrAddress: `${id}` } }),
      http_mocks.createResponse(),
      () => undefined
    );

    await report.reload();
    await order.reload();

    expect(body).toEqual({
      ...(await location.asJSON()),
      hasTruck: false,
      orders: [
        {
          ...order.asJSON(),
          reports: (await order.reports).map((rep) => rep.asJSON()),
        },
      ],
      reports: [report.asJSON()],
      trucks: [],
    });
  });

  test("Gets a location with a + encoded address", async () => {
    const { fullAddress } = location ? location : null;

    const body = await controller.show(
      http_mocks.createRequest({
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({
      ...(await location.asJSON()),
      hasTruck: false,
      reports: [],
      orders: [],
      trucks: [],
    });
  });

  test("Gets a location with a space encoded address", async () => {
    const { fullAddress } = location ? location : null;

    const body = await controller.show(
      http_mocks.createRequest({
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({
      ...(await location.asJSON()),
      hasTruck: false,
      reports: [],
      orders: [],
      trucks: [],
    });
  });
  test("Gets a location with a space encoded address with auth headers", async () => {
    const { fullAddress } = location ? location : null;

    const body = await controller.show(
      http_mocks.createRequest({
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({
      ...(await location.asJSONPrivate()),
      hasTruck: false,
      reports: [],
      orders: [],
      trucks: [],
    });
  });
});

describe("#validate", () => {
  it("validates a location and logs the username", async () => {
    const user = "jimmy";

    const { fullAddress, id, validatedAt } = location ? location : null;
    expect(validatedAt).toBeNull();
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
    expect(action.userId).toEqual(user);
  });

  it("validates a location even without a username", async () => {
    const { fullAddress, id } = location ? location : null;
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
    expect(action.userId).toEqual("not specified");
  });

  it("return 401 status if bad api key", async () => {
    const { fullAddress } = location ? location : null;

    const response = http_mocks.createResponse();
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

    await Order.placeOrder({ quantity: 1, cost: 5 }, ordered.location);

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

    await new LocationsController().validate(
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
        hook: "ZAP_NEW_REPORT",
        report: report.asJSONPrivate(),
        location: await report.location.asJSONPrivate(),
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

    await Order.placeOrder({ quantity: 1, cost: 5 }, ordered.location);

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

    const { userId, actionType } = await Action.findOne({
      where: { entityId: id, entityType: location.constructor.name },
      order: { id: "DESC" },
    });
    expect(userId).toEqual("jimmy");
    expect(actionType).toEqual("skipped");

    await pending.reload();
    expect(pending.skippedAt).toBeTruthy();
    await ordered.reload();
    expect(ordered.skippedAt).toBeFalsy();
  });
});

describe("#truck", () => {
  it("assign a truck, associates all locations, logs the username", async () => {
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

    await Order.placeOrder({ quantity: 1, cost: 5 }, ordered.location);

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
    await controller.truck(
      http_mocks.createRequest({
        method: "PUT",
        body: { user: "jimmy", city_state: "annarbor-mi" },
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    await location.reload();
    expect(await location.hasTruckJSON()).toBeTruthy();
    const { userId, actionType } = await Action.findOne({
      where: { entityId: id, entityType: location.constructor.name },
      order: { id: "DESC" },
    });
    expect(userId).toEqual("jimmy");
    expect(actionType).toEqual("assigned truck");

    await pending.reload();
    expect(await pending.truck).toBeTruthy();
    await ordered.reload();
    expect(ordered.truck).toBeFalsy();
  });
});

describe("#order", () => {
  it("returns validation errors", async () => {
    const { fullAddress } = location ? location : null;
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
        cost: COST_ERROR,
      },
    });
    expect(response.statusCode).toEqual(422);
  });

  it("can create an order only with costs", async () => {
    const { fullAddress } = location ? location : null;
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
    expect(order.quantity).toEqual(32);
  });

  it("creates a donut order", async () => {
    const { fullAddress } = location ? location : null;
    await controller.order(
      http_mocks.createRequest({
        method: "PUT",
        body: { cost: "$500.23423", orderType: "donuts", quantity: "5" },
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    const [order] = await location.orders;

    expect(order.cost).toEqual(500.23);
    expect(order.orderType).toEqual("dozen donuts");
    expect(order.quantity).toEqual(5);
  });

  it("validates the order too", async () => {
    const { fullAddress } = location ? location : null;
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

    await Order.placeOrder({ quantity: 1, cost: 5 }, ordered.location);

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
    const response = http_mocks.createResponse();
    const body = await controller.order(
      http_mocks.createRequest({
        method: "PUT",
        body: {
          quantity: "5",
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
    expect(order.quantity).toEqual(5);
    expect(order.restaurant).toEqual("mario's house");

    const { userId, actionType } = await Action.findOne({
      where: { entityId: order.id, entityType: order.constructor.name },
    });
    expect(userId).toEqual("jim");
    expect(actionType).toEqual("ordered");

    await ordered.reload();
    expect(order).not.toEqual(ordered.order);

    await skipped.reload();
    expect(skipped.order).toBeFalsy();
  });
});

describe("#merge", () => {
  it("merges into another location", async () => {
    const { fullAddress, id } = location ? location : null;

    const canonicalLocation = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: "123 Street City WA 12345",

      address: "123 Street",
      city: "City",
      state: "WA",
      zip: "12345",
    });

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
    const order = await Order.placeOrder(
      { quantity: 1, cost: 5 },
      ordered.location
    );
    const truck = await location.assignTruck("someone", "abd-id");

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
    await controller.merge(
      http_mocks.createRequest({
        method: "DELETE",
        body: { user: "jimmy", canonicalId: canonicalLocation.id },
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    await location.reload();

    expect(location.validatedAt).toBeFalsy();
    expect(await location.canonicalLocation).toEqual(canonicalLocation);

    const { userId, actionType } = await Action.findOne({
      where: { entityId: id, entityType: location.constructor.name },
      order: { id: "DESC" },
    });
    expect(userId).toEqual("jimmy");
    expect(actionType).toEqual(`merged into ${canonicalLocation.id}`);

    const {
      userId: mergedUserId,
      actionType: mergedActionType,
    } = await Action.findOne({
      where: {
        entityId: canonicalLocation.id,
        entityType: location.constructor.name,
      },
      order: { id: "DESC" },
    });
    expect(mergedUserId).toEqual("jimmy");
    expect(mergedActionType).toEqual(`absorbed ${id}`);

    for (const obj of [pending, order, ordered, truck]) {
      await obj.reload();
      expect(obj.location).toEqual(canonicalLocation);
    }
  });
});
