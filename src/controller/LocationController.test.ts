import * as http_mocks from "node-mocks-http";

import { LocationController } from "./LocationController";
import { Location } from "../entity/Location";

let location: Location | null;

beforeAll(async () => {
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

    expect(body).toEqual(await Location.findOne({ where: { id } }));
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
