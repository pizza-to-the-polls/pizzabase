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
  location = await Location.getOrCreateFromAddress({
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
    expect(body).toEqual({ errors: ["Not found"] });
  });

  test("Gets a location with an ID", async () => {
    const controller = new LocationController();

    const { id } = location ? location : null;

    const body = await controller.one(
      http_mocks.createRequest({ params: { idOrAddress: `${id}` } }),
      http_mocks.createResponse(),
      () => undefined
    );

    await location.reload();
    expect(body).toEqual(location);
  });

  test("Gets a location with a + encoded address", async () => {
    const controller = new LocationController();

    const { fullAddress, id } = location ? location : null;

    const body = await controller.one(
      http_mocks.createRequest({
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual(await Location.findOne({ where: { id } }));
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

    await location.reload();
    expect(body).toEqual(location);
  });
});

describe("#validate", () => {
  it("validates a location and logs the username", async () => {
    const user = "jimmy";

    const { fullAddress, id, validatedAt } = location ? location : null;
    expect(validatedAt).toBeNull();

    const controller = new LocationController();
    const body = await controller.validate(
      http_mocks.createRequest({
        method: "PATCH",
        body: { user },
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    const updatedLoc = await Location.findOne({ where: { id } });

    expect(updatedLoc.validatedAt).toBeTruthy();
    expect(body).toEqual(updatedLoc);
    const action = await Action.findOne({
      where: { entityId: id, entityType: location.constructor.name },
    });
    expect(action.user).toEqual(user);
  });

  it("validates a location even without a username", async () => {
    const { fullAddress, id } = location ? location : null;

    const controller = new LocationController();
    const body = await controller.validate(
      http_mocks.createRequest({
        method: "PATCH",
        body: {},
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    await location.reload();
    expect(location.validatedAt).toBeTruthy();
    expect(body).toEqual(location);
    const action = await Action.findOne({
      where: { entityId: id, entityType: location.constructor.name },
    });
    expect(action.user).toEqual("not specified");
  });

  it("once validate ", async () => {
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

    await Report.createNewReport("222-234-2345", "http://insta.com/what", {
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
        method: "PATCH",
        body: {},
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(fetch.mock.calls.length).toBe(1);
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
    const body = await controller.skip(
      http_mocks.createRequest({
        method: "PATCH",
        body: { user: "jimmy" },
        params: { idOrAddress: fullAddress.replace(/\s/g, "+") },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    await location.reload();
    expect(body).toEqual(location);

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
