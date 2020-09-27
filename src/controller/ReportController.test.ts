import test from "ava";
import * as http_mocks from "node-mocks-http";

import { ReportController } from "./ReportController";
import dbHelper from "../tests/dbHelper";
import { Location } from "../entity/Location";
import { Report } from "../entity/Report";

test.before(async (_t) => await dbHelper.setUpDB());

test.after.always(async (_t) => await dbHelper.closeDB());

test("Sends 422 and errors on empty response", async (t) => {
  const controller = new ReportController();
  const request = http_mocks.createRequest({
    method: "POST",
  });

  const response = http_mocks.createResponse();

  const body = await controller.create(request, response, () => undefined);

  t.deepEqual(body, {
    errors: {
      url: "Invalid URL - please supply a valid URL",
      contact:
        "Invalid contact - please supply an email address or phone number",
      address: "Invalid address - please supply a valid address",
    },
  });

  t.is(response.statusCode, 422);
});

test("Sends 422 and errors on invalid response", async (t) => {
  const controller = new ReportController();
  const request = http_mocks.createRequest({
    method: "POST",
    body: {
      url: "not-valid",
      contact: "not-valid",
      address: "not-valid",
    },
  });

  const response = http_mocks.createResponse();

  const body = await controller.create(request, response, () => undefined);

  t.deepEqual(body, {
    errors: {
      url: "Invalid URL - please supply a valid URL",
      contact:
        "Invalid contact - please supply an email address or phone number",
      address: "Invalid address - please supply a valid address",
    },
  });

  t.is(response.statusCode, 422);
});

test("New request/loc returns success, creates location and report", async (t) => {
  const url = "http://twitter.com/something/";
  const address = "5335 S Kimbark Ave Chicago IL 60615";
  const contact = "555-234-2345";

  const controller = new ReportController();
  const request = http_mocks.createRequest({
    method: "POST",
    body: { url, contact, address },
  });

  const response = http_mocks.createResponse();

  const body = await controller.create(request, response, () => undefined);

  t.deepEqual(body, { success: true });
  t.is(response.statusCode, 200);

  const location = await Location.findOne({ where: { fullAddress: address } });
  t.truthy(location);
  t.falsy(location.isApproved);

  const report = await Report.findOne({ where: { reportURL: url } });
  t.truthy(report);
  t.deepEqual(report.location, location);
  t.falsy(report.order);
});

test("Re-used loc / new returns success, sets existing location and creates new report", async (t) => {
  const url = "http://twitter.com/something/";
  const address = "5335 S Kimbark Ave Chicago IL 60615";
  const contact = "555-234-2345";

  const location = await Location.getOrCreateFromAddress({
    latitude: 41.79907,
    longitude: -87.58413,

    fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

    address: "5335 S Kimbark Ave",
    city: "Chicago",
    state: "IL",
    zip: "60615",
  });

  const controller = new ReportController();
  const request = http_mocks.createRequest({
    method: "POST",
    body: { url, contact, address },
  });

  const response = http_mocks.createResponse();

  const body = await controller.create(request, response, () => undefined);

  t.deepEqual(body, { success: true });
  t.is(response.statusCode, 200);

  const report = await Report.findOne({ where: { reportURL: url } });
  t.truthy(report);
  t.deepEqual(report.location.id, location.id);
});
