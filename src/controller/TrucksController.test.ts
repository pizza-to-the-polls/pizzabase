import * as http_mocks from "node-mocks-http";

import { TrucksController } from "./TrucksController";
import { Truck } from "../entity/Truck";
import { Location } from "../entity/Location";
import { ADDRESS_ERROR } from "../lib/validator/constants";
import { buildTestData } from "../tests/factories";
jest.mock("../lib/validator/geocode");

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
        address: ADDRESS_ERROR,
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

describe("#all", () => {
  beforeEach(async () => {
    await buildTestData();
    const locations = await Location.find();
    let trucks = 0;

    for (const location of locations) {
      const truck = await location.assignTruck("jim", "hobbiton-shire");
      const old = new Date(new Date(Number(new Date()) - 1000 * 60 * 60 * 5));
      trucks += 1;
      if (trucks > 3) {
        await Location.query(`
          UPDATE trucks SET created_at = '${old.toISOString()}' WHERE trucks.id = ${
          truck.id
        }
        `);
      }
    }
  });

  it("returns the active trucks", async () => {
    const body = await controller.all(
      http_mocks.createRequest({
        method: "GET",
        query: { limit: 3 },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    const [trucks, active] = await Truck.findAndCountActiveTrucks();
    expect(body.count).toEqual(active);
    expect(body.results.length).toEqual(3);
    expect(body.results).toEqual(
      await Promise.all(
        trucks.slice(0, 3).map(async (truck) => ({
          ...truck.asJSON(),
          location: await truck.location.asJSON(),
        }))
      )
    );
  });

  it("returns all trucks", async () => {
    const body = await controller.all(
      http_mocks.createRequest({
        method: "GET",
        query: { past: true },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(body.count).toEqual((await Location.find()).length);
  });

  it("returns trucks for a location", async () => {
    const location = (await Truck.findOne({ order: { createdAt: "ASC" } }))
      .location;
    const body = await controller.all(
      http_mocks.createRequest({
        method: "GET",
        query: { past: true, location: location.id },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(body.count).toEqual(1);
    expect(body.results).toEqual([
      {
        ...(await location.trucks)[0].asJSON(),
        location: await location.asJSON(),
      },
    ]);
  });

  it("returns trucks for a location", async () => {
    const location = (await Truck.findOne({ order: { createdAt: "DESC" } }))
      .location;
    const body = await controller.all(
      http_mocks.createRequest({
        method: "GET",
        query: { location: location.id },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(body.count).toEqual(1);
    expect(body.results).toEqual([
      {
        ...(await location.trucks)[0].asJSON(),
        location: await location.asJSON(),
      },
    ]);
  });
});
