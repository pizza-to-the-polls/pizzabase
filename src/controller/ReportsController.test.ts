import * as http_mocks from "node-mocks-http";

import { ReportsController } from "./ReportsController";
import { Location } from "../entity/Location";
import { Report } from "../entity/Report";
import { Order } from "../entity/Order";
import { Action } from "../entity/Action";
import {
  ADDRESS_ERROR,
  URL_ERROR,
  CONTACT_ERROR,
} from "../lib/validator/constants";

import { buildTestData } from "../tests/factories";

jest.mock("../lib/validator/geocode");
jest.mock("node-fetch");

import fetch from "node-fetch";

const controller = new ReportsController();

describe("#create", () => {
  test("Sends 422 and errors on empty response", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
    });

    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(body).toEqual({
      errors: {
        url: URL_ERROR,
        contact: CONTACT_ERROR,
        address: ADDRESS_ERROR,
      },
    });

    expect(response.statusCode).toEqual(422);
  });

  test("Sends 422 and errors on invalid response", async () => {
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
        url: URL_ERROR,
        contact: CONTACT_ERROR,
        address: ADDRESS_ERROR,
      },
    });

    expect(response.statusCode).toEqual(422);
  });

  test("Trusted reporters can override valdiation", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        address: "not-valid",
        user: "jimmy",
        waitTime: "5000",
        addressOverride: {
          address: "123 Sesame",
          city: "city",
          state: "WA",
          zip: "12345",
          latitude: "420",
          longitude: "-420",
        },
      },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });

    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(body).toEqual({
      address: "123 Sesame city WA 12345",
      hasTruck: false,
      willReceive: false,
      alreadyOrdered: false,
    });
    expect(response.statusCode).toEqual(200);

    const location = await Location.findOne({
      where: { fullAddress: "123 Sesame city WA 12345" },
    });
    expect(location).toBeTruthy();
    expect(location.validatedAt).toBeTruthy();

    const report = await Report.findOne({
      where: { location: { id: location.id } },
    });
    expect(report).toBeTruthy();
    expect(report.location).toEqual(location);
    expect(report.order).toBeFalsy();
    expect(report.waitTime).toEqual("5000");
    expect(report.contactRole).toEqual("Trusted");

    const action = await Action.findOne({
      where: { entityId: report.id, entityType: report.constructor.name },
    });
    expect(action.userId).toEqual("jimmy");
  });

  test("New request/loc returns success, creates location, report, zaps new location", async () => {
    const url = "http://twitter.com/something/status/123";
    const address = "5335 S Kimbark Ave Chicago IL 60615";
    const contact = "555-234-2345";
    const waitTime = "5";
    const contactFirstName = "Jim";
    const contactLastName = "Jim";
    const contactRole = "Poll Worker";
    const canDistribute = true;

    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        url,
        contact,
        address,
        waitTime,
        contactFirstName,
        contactLastName,
        contactRole,
        canDistribute,
      },
    });

    const response = http_mocks.createResponse();
    const body = await controller.create(request, response, () => undefined);

    expect(body).toEqual({
      address,
      hasTruck: false,
      willReceive: true,
      alreadyOrdered: false,
    });
    expect(response.statusCode).toEqual(200);

    const location = await Location.findOne({
      where: { fullAddress: address },
    });
    expect(location).toBeTruthy();
    expect(location.validatedAt).toBeFalsy();

    const report = await Report.findOne({ where: { reportURL: url } });
    expect(report).toBeTruthy();
    expect(report.location).toEqual(location);
    expect(report.order).toBeFalsy();
    expect(report.waitTime).toEqual(waitTime);
    expect(report.contactFirstName).toEqual(contactFirstName);
    expect(report.contactLastName).toEqual(contactLastName);
    expect(report.contactRole).toEqual(contactRole);

    const [zapUrl, { body: zapBody }] = (fetch as any).mock.calls[0];
    expect(zapUrl).toEqual(process.env.ZAP_NEW_LOCATION);
    expect(zapBody).toEqual(
      JSON.stringify({
        hook: "ZAP_NEW_LOCATION",
        report: report.asJSONPrivate(),
        location: await report.location.asJSONPrivate(),
      })
    );
  });

  test("Re-used loc / new returns success, sets existing location, creates new report, zaps new report", async () => {
    const url = "http://twitter.com/different/status/123";
    const address = "5335 S Kimbark Ave Chicago IL 60615";
    const contact = "555-234-2345";
    const waitTime = "5";
    const canDistribute = true;

    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    location.validatedAt = new Date();
    await location.save();

    const request = http_mocks.createRequest({
      method: "POST",
      body: { url, contact, address, waitTime, canDistribute },
    });

    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(body).toEqual({
      address,
      hasTruck: false,
      willReceive: true,
      alreadyOrdered: false,
    });
    expect(response.statusCode).toBe(200);

    const report = await Report.findOne({ where: { reportURL: url } });
    expect(report).toBeTruthy();
    expect(report.location.id).toBe(location.id);

    const [zapUrl, { body: zapBody }] = (fetch as any).mock.calls[0];
    expect(zapUrl).toEqual(process.env.ZAP_NEW_REPORT);
    expect(zapBody).toEqual(
      JSON.stringify({
        hook: "ZAP_NEW_REPORT",
        report: report.asJSONPrivate(),
        location: await report.location.asJSONPrivate(),
      })
    );
  });

  test("Re-used loc / re-used url, sets existing location, creates new report, does not zap", async () => {
    const url = "http://twitter.com/different/status/123";
    const address = "5335 S Kimbark Ave Chicago IL 60615";
    const contact = "555-234-2345";
    const waitTime = "5";
    const canDistribute = true;

    const [existingReport] = await Report.createNewReport(
      contact,
      url,
      {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress: address,

        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zip: "60615",
      },
      { canDistribute: true }
    );

    const request = http_mocks.createRequest({
      method: "POST",
      body: { url, contact, address, waitTime, canDistribute },
    });

    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(body).toEqual({
      address,
      hasTruck: false,
      willReceive: false,
      alreadyOrdered: false,
    });
    expect(response.statusCode).toBe(200);

    const report = await Report.findOne({ where: { reportURL: url } });
    expect(report).toBeTruthy();
    expect(report.location.id).toBe(existingReport.location.id);

    expect((fetch as any).mock.calls.length).toBe(0);
  });

  test("New loc / re-used url, creates new report, zaps new location", async () => {
    const url = "http://twitter.com/anewone/status/123";
    const address = "550 Different Address City OR 12345";
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

    const request = http_mocks.createRequest({
      method: "POST",
      body: { url, contact, address },
    });

    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(body).toEqual({
      address,
      hasTruck: false,
      willReceive: false,
      alreadyOrdered: false,
    });
    expect(response.statusCode).toBe(200);

    const report = await Report.findOne({ where: { contactInfo: contact } });
    expect(report).toBeTruthy();

    const [zapUrl, { body: zapBody }] = (fetch as any).mock.calls[0];
    expect(zapUrl).toEqual(process.env.ZAP_NEW_LOCATION);
    expect(zapBody).toEqual(
      JSON.stringify({
        hook: "ZAP_NEW_LOCATION",
        report: report.asJSONPrivate(),
        location: await report.location.asJSONPrivate(),
      })
    );
  });

  test("Re-used loc with truck / new url returns success, sets existing location, creates new report, no zap", async () => {
    const url = "http://twitter.com/different/status/123";
    const address = "5335 S Kimbark Ave Chicago IL 60615";
    const contact = "555-234-2345";

    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    location.validatedAt = new Date();
    await location.save();
    const truck = await location.assignTruck("scott", "detroit-mi");

    const request = http_mocks.createRequest({
      method: "POST",
      body: { url, contact, address },
    });

    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(body).toEqual({
      address,
      hasTruck: true,
      willReceive: false,
      alreadyOrdered: false,
    });
    expect(response.statusCode).toBe(200);

    const report = await Report.findOne({ where: { reportURL: url } });
    expect(report).toBeTruthy();
    expect(report.location.id).toBe(location.id);
    expect(report.truck.id).toBe(truck.id);

    expect((fetch as any).mock.calls.length).toEqual(0);
  });

  test("Re-used loc with order / new url returns success, sets existing location, creates new report, no zap", async () => {
    const url = "http://twitter.com/different/status/123";
    const address = "5335 S Kimbark Ave Chicago IL 60615";
    const contact = "555-234-2345";

    const [report] = await Report.createNewReport("333-234-2345", url, {
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });

    const order = await Order.placeOrder(
      { cost: 50, quantity: 5 },
      report.location
    );

    const request = http_mocks.createRequest({
      method: "POST",
      body: { url, contact, address },
    });

    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(body).toEqual({
      address,
      hasTruck: false,
      willReceive: false,
      alreadyOrdered: true,
    });
    expect(response.statusCode).toBe(200);

    await report.reload();
    const newReport = await Report.findOne({ where: { reportURL: url } });
    expect(newReport).toBeTruthy();
    expect(newReport.location.id).toBe(report.location.id);
    expect(newReport.order.id).toBe(order.id);
    expect(report.order.id).toBe(order.id);

    expect((fetch as any).mock.calls.length).toEqual(0);
  });

  test("Non-cannonical loc, creates new report on canonical loc", async () => {
    const url = "http://twitter.com/different/status/123";
    const address = "5335 S Kimbark Ave Chicago IL 60615";
    const contact = "555-234-2345";

    const canonicalLoc = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: "123 different st city OK zip",

      address: "123 different st",
      city: "city",
      state: "OK",
      zip: "zip",
    });

    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: address,

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    location.canonicalLocation = canonicalLoc;
    await location.save();

    const request = http_mocks.createRequest({
      method: "POST",
      body: { url, contact, address },
    });

    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(body).toEqual({
      address: "123 different st city OK zip",
      hasTruck: false,
      willReceive: false,
      alreadyOrdered: false,
    });
    expect(response.statusCode).toBe(200);

    const newReport = await Report.findOne({ where: { reportURL: url } });
    expect(newReport.location.id).toBe(canonicalLoc.id);
  });
});

describe("#index", () => {
  beforeEach(async () => await buildTestData());

  test("Lists the reports", async () => {
    const body = await controller.index(
      http_mocks.createRequest({ query: { limit: "5" } }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({
      results: await Promise.all(
        (await Report.find({ take: 5, order: { createdAt: "DESC" } })).map(
          async (report) => ({
            ...report.asJSON(),
            location: await report.location.asJSON(),
            order: report.order?.asJSON(),
            truck: report.truck?.asJSON(),
          })
        )
      ),
      count: await Report.count(),
    });
  });

  test("Lists the reports for a truck", async () => {
    const location = await Location.findOne({ where: {} });
    const truck = await location.assignTruck();

    const body = await controller.index(
      http_mocks.createRequest({ query: { truck: `${truck.id}` } }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({
      results: await Promise.all(
        (
          await Report.find({
            order: { createdAt: "DESC" },
            where: { truck: { id: truck.id } },
          })
        ).map(async (report) => ({
          ...report.asJSON(),
          location: await report.location.asJSON(),
          order: report.order?.asJSON(),
          truck: report.truck?.asJSON(),
        }))
      ),
      count: await Report.count({ where: { truck: { id: truck.id } } }),
    });
  });

  test("Lists the reports for a location", async () => {
    const location = await Location.findOne({ where: {} });

    const body = await controller.index(
      http_mocks.createRequest({ query: { location: `${location.id}` } }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({
      results: await Promise.all(
        (
          await Report.find({
            order: { createdAt: "DESC" },
            where: { location: { id: location.id } },
          })
        ).map(async (report) => ({
          ...report.asJSON(),
          location: await report.location.asJSON(),
          order: report.order?.asJSON(),
          truck: report.truck?.asJSON(),
        }))
      ),
      count: await Report.count({ where: { location: { id: location.id } } }),
    });
  });

  test("Lists the reports for an order", async () => {
    const order = await Order.findOne({ where: {} });

    const body = await controller.index(
      http_mocks.createRequest({ query: { order: `${order.id}` } }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({
      results: await Promise.all(
        (
          await Report.find({
            order: { createdAt: "DESC" },
            where: { order: { id: order.id } },
          })
        ).map(async (report) => ({
          ...report.asJSON(),
          location: await report.location.asJSON(),
          order: report.order?.asJSON(),
          truck: report.truck?.asJSON(),
        }))
      ),
      count: await Report.count({ where: { order: { id: order.id } } }),
    });
  });
});

describe("#show", () => {
  beforeEach(async () => await buildTestData());

  it("returns a report", async () => {
    const report = await Report.findOne({ where: {} });
    const body = await controller.show(
      http_mocks.createRequest({ params: { id: `${report.id}` } }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({
      ...report.asJSON(),
      location: await report.location.asJSON(),
      order: report.order?.asJSON(),
      truck: report.truck?.asJSON(),
    });
  });
});
