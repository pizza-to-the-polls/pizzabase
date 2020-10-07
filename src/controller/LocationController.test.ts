import * as http_mocks from "node-mocks-http";

import dbHelper from "../tests/dbHelper";
import { LocationController } from "./LocationController";
import { Location } from "../entity/Location";

let location: Location | null;

beforeAll(async () => {
  await dbHelper.setUpDB();

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
afterAll(async () => {
  await dbHelper.closeDB();
});

test("Lists the locations", async () => {
  const controller = new LocationController();

  const body = await controller.all(
    http_mocks.createRequest(),
    http_mocks.createResponse(),
    () => undefined
  );

  expect(body).toEqual(await Location.find());
});

test("Gets a location", async () => {
  const controller = new LocationController();

  const { id } = location ? location : null;

  const body = await controller.one(
    http_mocks.createRequest({ params: { id: `${id}` } }),
    http_mocks.createResponse(),
    () => undefined
  );

  expect(body).toEqual(await Location.findOne({ where: { id } }));
});
