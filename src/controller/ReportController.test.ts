import * as http_mocks from "node-mocks-http";

import { ReportController } from "./ReportController";
import { Location } from "../entity/Location";
import { Report } from "../entity/Report";

jest.mock("../lib/validator/normalizeAddress");
jest.mock("node-fetch");

import fetch from "node-fetch";

test("Sends 422 and errors on empty response", async () => {
  const controller = new ReportController();
  const request = http_mocks.createRequest({
    method: "POST",
  });

  const response = http_mocks.createResponse();

  const body = await controller.create(request, response, () => undefined);

  expect(body).toEqual({
    errors: {
      url: "Invalid URL - please supply a valid URL",
      contact:
        "Invalid contact - please supply an email address or phone number",
      address: "Invalid address - please supply a valid address",
    },
  });

  expect(response.statusCode).toEqual(422);
});

test("Sends 422 and errors on invalid response", async () => {
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

  expect(body).toEqual({
    errors: {
      url: "Invalid URL - please supply a valid URL",
      contact:
        "Invalid contact - please supply an email address or phone number",
      address: "Invalid address - please supply a valid address",
    },
  });

  expect(response.statusCode).toEqual(422);
});

test("New request/loc returns success, creates location, report, zaps", async () => {
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

  expect(body).toEqual({ success: true });
  expect(response.statusCode).toEqual(200);

  const location = await Location.findOne({ where: { fullAddress: address } });
  expect(location).toBeTruthy();
  expect(location.isApproved).toBeFalsy();

  const report = await Report.findOne({ where: { reportURL: url } });
  expect(report).toBeTruthy();
  expect(report.location).toEqual(location);
  expect(report.order).toBeFalsy();

  const { order: _order, location: _loc, ...rest } = report;

  expect(fetch.mock.calls[0]).toEqual([
    process.env.ZAP_NEW_REPORT,
    {
      ...rest,
      ...location,
    },
  ]);
});

test("Re-used loc / new returns success, sets existing location, creates new report, zaps", async () => {
  const url = "http://twitter.com/different/";
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

  expect(body).toEqual({ success: true });
  expect(response.statusCode).toBe(200);

  const report = await Report.findOne({ where: { reportURL: url } });
  expect(report).toBeTruthy();
  expect(report.location.id).toBe(location.id);

  const { order: _order, location: _loc, ...rest } = report;

  expect(fetch.mock.calls[0]).toEqual([
    process.env.ZAP_NEW_REPORT,
    {
      ...rest,
      ...location,
    },
  ]);
});

test("Re-used loc / re-used url, sets existing location, creates new report, does not zap", async () => {
  const url = "http://twitter.com/different/";
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

  expect(body).toEqual({ success: true });
  expect(response.statusCode).toBe(200);

  const report = await Report.findOne({ where: { reportURL: url } });
  expect(report).toBeTruthy();
  expect(report.location.id).toBe(location.id);

  expect(fetch.mock.calls.length).toBe(0);
});

test("New loc / re-used url, creates new report, does not zap", async () => {
  const url = "http://twitter.com/anewone/";
  const address = "5050 S Kimbark Ave Chicago IL 60615";
  const contact = "666-234-2345";

  await Report.createNewReport("333-234-2345", url, {
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

  expect(body).toEqual({ success: true });
  expect(response.statusCode).toBe(200);

  const report = await Report.findOne({ where: { contactInfo: contact } });
  expect(report).toBeTruthy();

  const { order: _order, location, ...rest } = report;

  expect(fetch.mock.calls[0]).toEqual([
    process.env.ZAP_NEW_REPORT,
    {
      ...rest,
      ...location,
    },
  ]);
});
