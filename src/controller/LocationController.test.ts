import anyTest, { TestInterface } from "ava";
import * as http_mocks from "node-mocks-http";

import { LocationController } from "./LocationController";
import dbHelper from "../tests/dbHelper";
import { Location } from "../entity/Location";

const test = anyTest as TestInterface<{ location: Location }>;

test.before(async (t) => {
  await dbHelper.setUpDB();

  const location = await Location.getOrCreateFromAddress({
    latitude: 41.79907,
    longitude: -87.58413,

    fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

    address: "5335 S Kimbark Ave",
    city: "Chicago",
    state: "IL",
    zip: "60615",
  });

  t.context = { location };
});

test.after.always(async (_t) => await dbHelper.closeDB());

test("Lists the locations", async (t) => {
  const controller = new LocationController();

  const body = await controller.all(
    http_mocks.createRequest(),
    http_mocks.createResponse(),
    () => undefined
  );

  t.deepEqual(body, await Location.find());
});

test("Gets a location", async (t) => {
  const controller = new LocationController();

  const { id } = t.context ? t.context.location : null;

  const body = await controller.one(
    http_mocks.createRequest({ params: { id: `${id}` } }),
    http_mocks.createResponse(),
    () => undefined
  );

  t.deepEqual(body, await Location.findOne({ where: { id } }));
});
