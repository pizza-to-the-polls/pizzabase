import * as http_mocks from "node-mocks-http";

import { TrucksController } from "./TrucksController";
import { Truck } from "../entity/Truck";
import { Location } from "../entity/Location";

jest.mock("../lib/validator/normalizeAddress");

const controller = new TrucksController();

describe("#create", () => {
  it("returns validation errors", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.create(
      http_mocks.createRequest({
        method: "POST",
        body: { address: null },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined
    );
    expect(body).toEqual({
      errors: {
        address: "Invalid address - please supply a valid address",
      },
    });
    expect(response.statusCode).toEqual(422);
  });

  it("can create an order on an existing location", async () => {
    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    await controller.create(
      http_mocks.createRequest({
        method: "POST",
        body: { address: location.fullAddress },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    await location.reload();
    const truck = await location.activeTruck();

    expect(truck.identifier).toEqual(`${location.city}-${location.state}`);
    expect(location.validatedAt).toBeTruthy();
  });

  it("can create an order on a new location", async () => {
    await controller.create(
      http_mocks.createRequest({
        method: "POST",
        body: {
          identifier: "detroit-mi",
          address: "550 Different Address City OR 12345",
        },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    const truck = await Truck.findOne({ where: { identifier: "detroit-mi" } });

    expect(truck.location.fullAddress).toEqual(
      "550 Different Address City OR 12345"
    );
    expect(truck.location.validatedAt).toBeTruthy();
  });
});
