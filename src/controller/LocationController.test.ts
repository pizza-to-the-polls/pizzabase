import test from "ava";
import * as http_mocks from "node-mocks-http";

import { LocationController } from "./LocationController";
import dbHelper from "../tests/dbHelper";
import { Location } from "../entity/Location";

test.before(async (_t) => await dbHelper.setUpDB());

test.after.always(async (_t) => await dbHelper.closeDB());

test("Lists the locations", async (t) => {
  const controller = new LocationController();

  await Location.getOrCreateFromAddress({
    latitude: 41.79907,
    longitude: -87.58413,

    fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

    address: "5335 S Kimbark Ave",
    city: "Chicago",
    state: "IL",
    zip: "60615",
  });

  const body = await controller.all(
    http_mocks.createRequest(),
    http_mocks.createResponse(),
    () => undefined
  );

  t.deepEqual(body, await Location.find());
});
