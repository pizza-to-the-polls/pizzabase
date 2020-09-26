import test from "ava";
import * as http_mocks from "node-mocks-http";

import { ReportController } from "./ReportController";
import dbHelper from "../tests/dbHelper";

test.before(async (t) => await dbHelper.setUpDB());

test.after.always(async (t) => await dbHelper.closeDB());

test("Sends 422 and errors on empty response", async (t) => {
  const controller = new ReportController();
  const request = http_mocks.createRequest({
    method: "POST",
  });

  const response = http_mocks.createResponse();

  const body = await controller.create(request, response, () => {});

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

  const body = await controller.create(request, response, () => {});

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

test("Sends 200 and returns success on success", async (t) => {
  const controller = new ReportController();
  const request = http_mocks.createRequest({
    method: "POST",
    body: {
      url: "http://twitter.com/something/",
      contact: "555-234-2345",
      address: "5335 S Kimbark Ave, Chicago IL 60615",
    },
  });

  const response = http_mocks.createResponse();

  const body = await controller.create(request, response, () => {});

  t.deepEqual(body, { success: true });

  t.is(response.statusCode, 200);
});
