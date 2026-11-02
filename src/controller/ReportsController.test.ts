import * as http_mocks from "node-mocks-http";

import { ReportsController } from "./ReportsController";
import { Location } from "../entity/Location";
import { Report } from "../entity/Report";
import { Upload } from "../entity/Upload";
import { Order } from "../entity/Order";
import { Action } from "../entity/Action";
import { BannedPhoneNumber } from "../entity/BannedPhoneNumber";
import {
  ADDRESS_ERROR,
  URL_ERROR,
  CONTACT_ERROR,
  GEORGIA_ERROR,
} from "../lib/validator/constants";

import { buildTestData } from "../tests/factories";

jest.mock("../lib/validator/geocode");

const controller = new ReportsController();

describe("#create", () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

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

    // FEAT-004: validation failure emits a structured log line with field
    // NAMES only — never values.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "report_validation_failed",
        fields: ["url", "contact", "address"],
        authed: false,
      }),
    );
    const loggedLine = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((arg: string) => arg?.includes("report_validation_failed"));
    expect(loggedLine).not.toContain("not-valid");
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

    // FEAT-004: same structured log line on the invalid-body path.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "report_validation_failed",
        fields: ["url", "contact", "address"],
        authed: false,
      }),
    );
  });

  test("Rejects Georgia line reports with 422, citing SB 22", async () => {
    const url = "http://twitter.com/something/status/123";
    const address = "206 Washington St SW Atlanta GA 30334";

    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        url,
        contact: "555-234-2345",
        address,
        waitTime: "1-2 hours",
        canDistribute: true,
      },
    });

    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(body).toEqual({ errors: { address: GEORGIA_ERROR } });
    expect(response.statusCode).toEqual(422);

    // FEAT-004: the structured log carries field NAMES only, never values.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "report_validation_failed",
        fields: ["address"],
        authed: false,
      }),
    );

    // Nothing was created: no report, no location.
    expect(await Report.findOne({ where: { reportURL: url } })).toBeNull();
    expect(
      await Location.findOne({ where: { fullAddress: address } }),
    ).toBeNull();
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
      autoSkipped: false,
      skipReason: null,
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
      autoSkipped: false,
      skipReason: null,
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

    const [zapUrl, { body: zapBody }] = (global.fetch as jest.Mock).mock
      .calls[0];
    expect(zapUrl).toEqual(process.env.ZAP_NEW_LOCATION);
    expect(zapBody).toEqual(
      JSON.stringify({
        hook: "ZAP_NEW_LOCATION",
        report: report.asJSONPrivate(),
        location: await report.location.asJSONPrivate(),
        hasUpload: false,
        media: [],
        otherReports: 0,
        locationHasLiveReport: false,
        locationValidatedRecently: false,
      }),
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
      autoSkipped: false,
      skipReason: null,
    });
    expect(response.statusCode).toBe(200);

    const report = await Report.findOne({ where: { reportURL: url } });
    expect(report).toBeTruthy();
    expect(report.location.id).toBe(location.id);
    expect(report.waitTime).toEqual(waitTime);
    expect(report.contactFirstName).toBeNull();
    expect(report.contactLastName).toBeNull();
    expect(report.contactRole).toBeNull();

    const [zapUrl, { body: zapBody }] = (global.fetch as jest.Mock).mock
      .calls[0];
    expect(zapUrl).toEqual(process.env.ZAP_NEW_REPORT);
    expect(zapBody).toEqual(
      JSON.stringify({
        hook: "ZAP_NEW_REPORT",
        report: report.asJSONPrivate(),
        location: await report.location.asJSONPrivate(),
        hasUpload: false,
        media: [],
        otherReports: 0,
        locationHasLiveReport: false,
        locationValidatedRecently: true,
      }),
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
      { canDistribute: true },
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
      autoSkipped: false,
      skipReason: null,
    });
    expect(response.statusCode).toBe(200);

    const report = await Report.findOne({ where: { reportURL: url } });
    expect(report).toBeTruthy();
    expect(report.location.id).toBe(existingReport.location.id);

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(0);
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
      autoSkipped: false,
      skipReason: null,
    });
    expect(response.statusCode).toBe(200);

    const report = await Report.findOne({ where: { contactInfo: contact } });
    expect(report).toBeTruthy();

    const [zapUrl, { body: zapBody }] = (global.fetch as jest.Mock).mock
      .calls[0];
    expect(zapUrl).toEqual(process.env.ZAP_NEW_LOCATION);
    expect(zapBody).toEqual(
      JSON.stringify({
        hook: "ZAP_NEW_LOCATION",
        report: report.asJSONPrivate(),
        location: await report.location.asJSONPrivate(),
        hasUpload: false,
        media: [],
        otherReports: 0,
        locationHasLiveReport: false,
        locationValidatedRecently: false,
      }),
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
      autoSkipped: false,
      skipReason: null,
    });
    expect(response.statusCode).toBe(200);

    const report = await Report.findOne({ where: { reportURL: url } });
    expect(report).toBeTruthy();
    expect(report.location.id).toBe(location.id);
    expect(report.truck.id).toBe(truck.id);

    expect((global.fetch as jest.Mock).mock.calls.length).toEqual(0);
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
      report.location,
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
      autoSkipped: false,
      skipReason: null,
    });
    expect(response.statusCode).toBe(200);

    await report.reload();
    const newReport = await Report.findOne({ where: { reportURL: url } });
    expect(newReport).toBeTruthy();
    expect(newReport.location.id).toBe(report.location.id);
    expect(newReport.order.id).toBe(order.id);
    expect(report.order.id).toBe(order.id);

    expect((global.fetch as jest.Mock).mock.calls.length).toEqual(0);
  });

  test("Banned phone number is silently skipped", async () => {
    const url = "http://twitter.com/something/status/banme";
    const address = "5335 S Kimbark Ave Chicago IL 60615";
    const contact = "555-234-2345";

    const ban = new BannedPhoneNumber();
    ban.phoneNumber = "5552342345";
    ban.reason = "Spam";
    ban.bannedBy = "admin";
    await ban.save();

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
      autoSkipped: false,
      skipReason: null,
    });
    expect(response.statusCode).toEqual(200);

    // Verify no report was created
    const report = await Report.findOne({
      where: { contactInfo: contact },
    });
    expect(report).toBeNull();

    // Verify no zapier hooks were called
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(0);
  });

  test("Email address is not checked against banned numbers", async () => {
    const url = "http://twitter.com/something/status/email";
    const address = "5335 S Kimbark Ave Chicago IL 60615";
    const contact = "test@example.com";

    const ban = new BannedPhoneNumber();
    ban.phoneNumber = "5552342345";
    ban.reason = "Spam";
    ban.bannedBy = "admin";
    await ban.save();

    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        url,
        contact,
        address,
        waitTime: "5",
        canDistribute: true,
      },
    });

    const response = http_mocks.createResponse();
    const body = await controller.create(request, response, () => undefined);

    // Email should be processed normally
    expect(body).toEqual({
      address,
      hasTruck: false,
      willReceive: true,
      alreadyOrdered: false,
      autoSkipped: false,
      skipReason: null,
    });
    expect(response.statusCode).toEqual(200);

    // Verify the report was created
    const report = await Report.findOne({ where: { reportURL: url } });
    expect(report).toBeTruthy();

    // Verify zapier hook was called
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0);
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
      autoSkipped: false,
      skipReason: null,
    });
    expect(response.statusCode).toBe(200);

    const newReport = await Report.findOne({ where: { reportURL: url } });
    expect(newReport.location.id).toBe(canonicalLoc.id);
  });

  describe("auto-skip (flag off — default)", () => {
    test("a recent order does NOT auto-skip; report flows to volunteer triage", async () => {
      const url = "http://twitter.com/flagoff/status/123";
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

      // Order placed for this location moments ago — with the flag on this
      // would auto-skip; flag off it must not.
      await Order.placeOrder({ cost: 50, quantity: 5 }, location);

      const request = http_mocks.createRequest({
        method: "POST",
        body: {
          url,
          contact,
          address,
          waitTime: "Less than one hour",
          canDistribute: true,
        },
      });

      const response = http_mocks.createResponse();
      const body = await controller.create(request, response, () => undefined);

      expect(body).toEqual({
        address,
        hasTruck: false,
        willReceive: true,
        alreadyOrdered: false,
        autoSkipped: false,
        skipReason: null,
      });
      expect(response.statusCode).toBe(200);

      // Not skipped, and the volunteer new-report Zap fired instead.
      const report = await Report.findOne({ where: { reportURL: url } });
      expect(report.skippedAt).toBeFalsy();
      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toEqual(process.env.ZAP_NEW_REPORT);
    });
  });

  describe("auto-skip (AUTO_SKIP_REPORTS on)", () => {
    beforeEach(() => {
      process.env.AUTO_SKIP_REPORTS = "true";
    });

    afterEach(() => {
      // Suites share one Node process (maxWorkers: 1) — never leak the
      // flag into later test files.
      delete process.env.AUTO_SKIP_REPORTS;
    });

    test("auto-skips a report at a location ordered for within the last hour", async () => {
      const url = "http://twitter.com/recentorder/status/123";
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

      const order = await Order.placeOrder(
        { cost: 50, quantity: 5, restaurant: "Pequod's" },
        location,
      );

      const request = http_mocks.createRequest({
        method: "POST",
        body: {
          url,
          contact,
          address,
          waitTime: "1-2 hours",
          canDistribute: true,
        },
      });

      const response = http_mocks.createResponse();
      const body = await controller.create(request, response, () => undefined);

      expect(body).toEqual({
        address,
        hasTruck: false,
        // auto-skipped → will not receive, even as a willing distributor
        willReceive: false,
        alreadyOrdered: false,
        autoSkipped: true,
        skipReason: "recent_order",
      });
      expect(response.statusCode).toBe(200);

      const report = await Report.findOne({ where: { reportURL: url } });
      expect(report).toBeTruthy();
      expect(report.skippedAt).toBeTruthy();

      // skippedAt set → the report is no longer open → a future order for the
      // location won't link it ("skip" semantics).
      const open = await Report.openReports(report.location);
      expect(open.map((r) => r.id)).not.toContain(report.id);

      // Audit trail for what happened and why.
      const action = await Action.findOne({
        where: { entityId: report.id, entityType: "Report" },
        order: { id: "DESC" },
      });
      expect(action.actionType).toEqual("auto-skipped (recent_order)");

      // The skip Zap fired (it texts the submitter when we ordered); the
      // new-report volunteer Zap did not.
      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls.length).toBe(1);
      const [zapUrl, { body: zapBody }] = calls[0];
      expect(zapUrl).toEqual(process.env.ZAP_SKIP_REPORT);
      const parsed = JSON.parse(zapBody);
      expect(parsed.hook).toEqual("ZAP_SKIP_REPORT");
      // createdAt crossed the wire as an ISO string — reload from the DB so
      // the expectation compares string-to-string, not Date-to-string.
      const savedOrder = await Order.findOneByOrFail({ id: order.id });
      expect(parsed.autoSkip).toEqual({
        reason: "recent_order",
        lastOrder: {
          createdAt: savedOrder.createdAt.toISOString(),
          quantity: savedOrder.quantity,
          orderType: savedOrder.orderType,
          restaurant: savedOrder.restaurant,
        },
      });
    });

    test("auto-skips a sub-hour line and zaps the resubmit note", async () => {
      const url = "http://twitter.com/shortline/status/123";
      const address = "5335 S Kimbark Ave Chicago IL 60615";
      const contact = "555-234-2345";

      const request = http_mocks.createRequest({
        method: "POST",
        body: {
          url,
          contact,
          address,
          waitTime: "Less than one hour",
          canDistribute: true,
        },
      });

      const response = http_mocks.createResponse();
      const body = await controller.create(request, response, () => undefined);

      expect(body).toEqual({
        address,
        hasTruck: false,
        willReceive: false,
        alreadyOrdered: false,
        autoSkipped: true,
        skipReason: "line_under_an_hour",
      });
      expect(response.statusCode).toBe(200);

      const report = await Report.findOne({ where: { reportURL: url } });
      expect(report).toBeTruthy();
      expect(report.skippedAt).toBeTruthy();
      expect(report.order).toBeFalsy();

      const action = await Action.findOne({
        where: { entityId: report.id, entityType: "Report" },
        order: { id: "DESC" },
      });
      expect(action.actionType).toEqual("auto-skipped (line_under_an_hour)");

      // Skip Zap only — no lastOrder for this reason; no volunteer Zap.
      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls.length).toBe(1);
      const [zapUrl, { body: zapBody }] = calls[0];
      expect(zapUrl).toEqual(process.env.ZAP_SKIP_REPORT);
      const parsed = JSON.parse(zapBody);
      expect(parsed.autoSkip).toEqual({
        reason: "line_under_an_hour",
        lastOrder: null,
      });
    });

    test("trusted report with a placeholder contact auto-skips without a submitter text", async () => {
      const request = http_mocks.createRequest({
        method: "POST",
        body: {
          waitTime: "Less than one hour",
          addressOverride: {
            address: "123 Placeholder Way",
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

      expect(body.autoSkipped).toBe(true);
      expect(body.skipReason).toEqual("line_under_an_hour");

      // Skipped and audited, but the skip Zap never fired — there is no real
      // phone to text (trusted contacts are placeholder emails).
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(0);
      const report = await Report.findOne({
        where: { contactInfo: "trusted@example.com" },
        order: { id: "DESC" },
      });
      expect(report.skippedAt).toBeTruthy();
      const action = await Action.findOne({
        where: { entityId: report.id, entityType: "Report" },
        order: { id: "DESC" },
      });
      expect(action.actionType).toEqual("auto-skipped (line_under_an_hour)");
    });
  });

  test("links upload to report when uploadId matches url", async () => {
    const filePath = "uploads/chicago-il-testabc.png";
    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,
      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    const upload = new Upload();
    upload.ipAddress = "127.0.0.1";
    upload.filePath = filePath;
    upload.location = location;
    await upload.save();

    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        url: `https://polls.pizza/${filePath}`,
        contact: "555-555-1234",
        address: "5335 S Kimbark Ave Chicago IL 60615",
        uploadId: upload.id,
      },
    });
    const response = http_mocks.createResponse();
    await controller.create(request, response, () => undefined);

    const report = await Report.findOne({
      where: { reportURL: `https://polls.pizza/${filePath}` },
      relations: ["upload"],
    });
    expect(report).toBeTruthy();
    expect(report.upload).toBeTruthy();
    expect(report!.upload!.id).toBe(upload.id);
  });

  test("returns 422 when uploadId url does not match filePath", async () => {
    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,
      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    const upload = new Upload();
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/chicago-il-different.png";
    upload.location = location;
    await upload.save();

    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        url: `https://polls.pizza/uploads/chicago-il-notmatching.png`,
        contact: "555-555-1234",
        address: "5335 S Kimbark Ave Chicago IL 60615",
        uploadId: upload.id,
      },
    });
    const response = http_mocks.createResponse();
    const body = await controller.create(request, response, () => undefined);

    expect(response.statusCode).toEqual(422);
    expect(body).toEqual({
      errors: { upload: "URL does not match uploaded file" },
    });

    // FEAT-004: upload-mismatch validation failures are logged too.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "report_validation_failed",
        fields: ["upload"],
        authed: false,
      }),
    );
  });

  test("does not link upload when no uploadId provided", async () => {
    const url = `https://polls.pizza/uploads/chicago-il-noid.png`;
    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        url,
        contact: "555-555-1234",
        address: "5335 S Kimbark Ave Chicago IL 60615",
      },
    });
    const response = http_mocks.createResponse();
    await controller.create(request, response, () => undefined);

    const report = await Report.findOne({
      where: { reportURL: url },
      relations: ["upload"],
    });
    expect(report).toBeTruthy();
    expect(report!.upload).toBeNull();
  });
});

describe("#index", () => {
  beforeEach(async () => await buildTestData());

  test("Lists the reports", async () => {
    const body = await controller.index(
      http_mocks.createRequest({ query: { limit: "5" } }),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body).toEqual({
      results: await Promise.all(
        (await Report.find({ take: 5, order: { createdAt: "DESC" } })).map(
          async (report) => ({
            ...report.asJSON(),
            location: await report.location.asJSON(),
            order: report.order?.asJSON(),
            truck: report.truck?.asJSON(),
          }),
        ),
      ),
      count: await Report.count(),
    });
  });

  test("Lists the reports for a truck", async () => {
    const location = await Location.findOne({
      where: {},
      order: { id: "ASC" },
    });
    const truck = await location.assignTruck();

    const body = await controller.index(
      http_mocks.createRequest({ query: { truck: `${truck.id}` } }),
      http_mocks.createResponse(),
      () => undefined,
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
        })),
      ),
      count: await Report.count({ where: { truck: { id: truck.id } } }),
    });
  });

  test("Lists the reports for a location", async () => {
    const location = await Location.findOne({
      where: {},
      order: { id: "ASC" },
    });

    const body = await controller.index(
      http_mocks.createRequest({ query: { location: `${location.id}` } }),
      http_mocks.createResponse(),
      () => undefined,
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
        })),
      ),
      count: await Report.count({ where: { location: { id: location.id } } }),
    });
  });

  test("Lists the reports for an order", async () => {
    const order = await Order.findOne({ where: {}, order: { id: "ASC" } });

    const body = await controller.index(
      http_mocks.createRequest({ query: { order: `${order.id}` } }),
      http_mocks.createResponse(),
      () => undefined,
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
        })),
      ),
      count: await Report.count({ where: { order: { id: order.id } } }),
    });
  });
});

describe("#show", () => {
  beforeEach(async () => await buildTestData());

  it("returns a report", async () => {
    const report = await Report.findOne({ where: {}, order: { id: "ASC" } });
    const body = await controller.show(
      http_mocks.createRequest({ params: { id: `${report.id}` } }),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body).toEqual({
      ...report.asJSON(),
      location: await report.location.asJSON(),
      order: report.order?.asJSON(),
      truck: report.truck?.asJSON(),
    });
  });
});

describe("#media", () => {
  const TEST_ADDRESS = {
    latitude: 41.79907,
    longitude: -87.58413,
    fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
    address: "5335 S Kimbark Ave",
    city: "Chicago",
    state: "IL",
    zip: "60615",
  };

  let consoleLogSpy: jest.SpyInstance;
  let report: Report;

  const createMmsUpload = async (n: number): Promise<Upload> => {
    const [upload] = await Upload.createFromMms(report, {
      fileExt: "jpg",
      fileHash: `mms-test-${report.id}-${n}-${Math.random()}`,
      sourcePhone: `+1555000${1000 + n}`,
    });
    return upload;
  };

  // Pin createdAt so "newest first" ordering is deterministic regardless
  // of how fast the inserts run.
  const pinCreatedAt = async (upload: Upload, minutesAgo: number) => {
    await Upload.createQueryBuilder()
      .update()
      .set({ createdAt: new Date(Date.now() - minutesAgo * 60_000) } as any)
      .where("id = :id", { id: upload.id })
      .execute();
  };

  const createWebUpload = async (): Promise<Upload> => {
    const upload = new Upload();
    upload.ipAddress = "127.0.0.1";
    upload.filePath = `uploads/chicago-il-web${report.id}.png`;
    upload.location = report.location;
    await upload.save();
    return upload;
  };

  const mediaRequest = (idOrAddress: string) =>
    http_mocks.createRequest({
      method: "GET",
      params: { idOrAddress },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });

  beforeEach(async () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    [report] = await Report.createNewReport(
      "555-555-0001",
      `http://twitter.com/status/media-${Date.now()}`,
      TEST_ADDRESS,
    );
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("returns 401 without auth", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.media(
      http_mocks.createRequest({
        method: "GET",
        params: { idOrAddress: `${report.id}` },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });

    // FEAT-004: unauthorized media requests are logged.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "report_not_authorized" }),
    );
  });

  it("returns 401 with a bad API key", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.media(
      http_mocks.createRequest({
        method: "GET",
        params: { idOrAddress: `${report.id}` },
        headers: { Authorization: "Basic not-a-real-key" },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });

    // FEAT-004: same log line for bad credentials.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "report_not_authorized" }),
    );
  });

  it("returns 404 for a nonexistent report", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.media(
      mediaRequest("999999"),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(404);
    expect(body).toBeUndefined();
  });

  it("resolves the report by numeric id", async () => {
    const body = await controller.media(
      mediaRequest(`${report.id}`),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body.report).toEqual({ id: report.id, reportURL: report.reportURL });
  });

  it("resolves the report by reportURL", async () => {
    const body = await controller.media(
      mediaRequest(report.reportURL),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body.report).toEqual({ id: report.id, reportURL: report.reportURL });
  });

  it("returns MMS uploads newest first", async () => {
    const first = await createMmsUpload(1);
    const second = await createMmsUpload(2);
    const third = await createMmsUpload(3);
    await pinCreatedAt(first, 30);
    await pinCreatedAt(second, 20);
    await pinCreatedAt(third, 10);

    const body = await controller.media(
      mediaRequest(`${report.id}`),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body.media.map((m) => m.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    expect(body.media.map((m) => m.source)).toEqual(["mms", "mms", "mms"]);
  });

  it("returns correct response shape for a ready MMS upload", async () => {
    const upload = await createMmsUpload(4);
    upload.mediaStatus = "ready";
    upload.sightengineScore = 0.04;
    upload.processedFilePath = {
      webp: `https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/${upload.id}/test.webp`,
      jobId: "mediaconvert-job-123",
    };
    await upload.save();

    const body = await controller.media(
      mediaRequest(`${report.id}`),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body.report).toEqual({ id: report.id, reportURL: report.reportURL });
    expect(body.media).toEqual([
      {
        id: upload.id,
        source: "mms",
        mediaStatus: "ready",
        sightengineScore: 0.04,
        createdAt: upload.createdAt,
        cdnUrl: `https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/${upload.id}/test.webp`,
        processedUrls: {
          webp: `https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/${upload.id}/test.webp`,
        },
      },
    ]);
  });

  it("includes the report's web upload when present", async () => {
    const mms = await createMmsUpload(5);
    const web = await createWebUpload();
    report.upload = web;
    await report.save();

    const body = await controller.media(
      mediaRequest(`${report.id}`),
      http_mocks.createResponse(),
      () => undefined,
    );

    const ids = body.media.map((m) => m.id);
    expect(ids).toContain(mms.id);
    expect(ids).toContain(web.id);

    const webItem = body.media.find((m) => m.id === web.id);
    expect(webItem.source).toEqual("web");
    const mmsItem = body.media.find((m) => m.id === mms.id);
    expect(mmsItem.source).toEqual("mms");
  });

  it("omits the web upload when the report has none", async () => {
    const mms = await createMmsUpload(6);

    const body = await controller.media(
      mediaRequest(`${report.id}`),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body.media.map((m) => m.id)).toEqual([mms.id]);
  });

  it("returns cdnUrl null for media that is not ready", async () => {
    const upload = await createMmsUpload(7);
    // createFromMms leaves mediaStatus as "processing"
    expect(upload.mediaStatus).toEqual("processing");

    const body = await controller.media(
      mediaRequest(`${report.id}`),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body.media).toHaveLength(1);
    expect(body.media[0].mediaStatus).toEqual("processing");
    expect(body.media[0].cdnUrl).toBeNull();
    expect(body.media[0].processedUrls).toEqual({});
  });

  it("returns cdnUrl null for failed media even with processed output", async () => {
    const upload = await createMmsUpload(8);
    upload.mediaStatus = "failed";
    upload.processedFilePath = {
      webp: `https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/${upload.id}/test.webp`,
    };
    await upload.save();

    const body = await controller.media(
      mediaRequest(`${report.id}`),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body.media[0].mediaStatus).toEqual("failed");
    expect(body.media[0].cdnUrl).toBeNull();
  });

  it("rewrites processed URLs against the media CDN", async () => {
    const previousDomain = process.env.MEDIA_CDN_DOMAIN;
    process.env.MEDIA_CDN_DOMAIN = "media.polls.pizza";

    try {
      const upload = await createMmsUpload(9);
      upload.mediaStatus = "ready";
      upload.processedFilePath = {
        mp4: `https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/${upload.id}/test_transcoded.mp4`,
      };
      await upload.save();

      const body = await controller.media(
        mediaRequest(`${report.id}`),
        http_mocks.createResponse(),
        () => undefined,
      );

      expect(body.media[0].cdnUrl).toEqual(
        `https://media.polls.pizza/uploads/${upload.id}/test_transcoded.mp4`,
      );
      expect(body.media[0].cdnUrl).not.toContain("s3.us-west-2.amazonaws.com");
    } finally {
      if (previousDomain === undefined) {
        delete process.env.MEDIA_CDN_DOMAIN;
      } else {
        process.env.MEDIA_CDN_DOMAIN = previousDomain;
      }
    }
  });

  it("picks mp4 as the primary URL for video and webp for images", async () => {
    const video = await createMmsUpload(10);
    video.mediaStatus = "ready";
    video.processedFilePath = {
      mp4: `https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/${video.id}/video.mp4`,
    };
    await video.save();

    const image = await createMmsUpload(11);
    image.mediaStatus = "ready";
    image.processedFilePath = {
      webp: `https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/${image.id}/image.webp`,
    };
    await image.save();

    const body = await controller.media(
      mediaRequest(`${report.id}`),
      http_mocks.createResponse(),
      () => undefined,
    );

    const byId = new Map(body.media.map((m) => [m.id, m]));
    expect(byId.get(video.id).cdnUrl).toContain("video.mp4");
    expect(byId.get(image.id).cdnUrl).toContain("image.webp");
  });
});

describe("#streetview", () => {
  const ADDRESS = {
    latitude: 41.79907,
    longitude: -87.58413,
    fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
    address: "5335 S Kimbark Ave",
    city: "Chicago",
    state: "IL",
    zip: "60615",
  };

  let originalKey: string | undefined;

  beforeAll(() => {
    originalKey = process.env.GOOGLE_MAPS_KEY;
    process.env.GOOGLE_MAPS_KEY = "test-streetview-key";
  });

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.GOOGLE_MAPS_KEY;
    } else {
      process.env.GOOGLE_MAPS_KEY = originalKey;
    }
  });

  const makeReport = async (): Promise<Report> => {
    const [report] = await Report.createNewReport(
      "555-234-2345",
      "http://twitter.com/test/status/999",
      ADDRESS,
    );
    return report;
  };

  const get = (id: number | string) => {
    const request = http_mocks.createRequest({ method: "GET" });
    request.params = { id: String(id) };
    return { request, response: http_mocks.createResponse() };
  };

  test("404s for an unknown report id", async () => {
    const { request, response } = get(9999999);
    // findOr404 sends the 404 itself; the action returns undefined so
    // app.ts skips the JSON res.send.
    const body = await controller.streetview(
      request,
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(404);
    expect(body).toBeUndefined();
  });

  test("proxies the Street View image for the report's location, key stays server-side", async () => {
    const report = await makeReport();

    // Larger than the tiny-body guard in fetchStreetViewImage (error
    // responses are < 1KB; real imagery is not).
    const imageBytes = new Uint8Array(2048);
    imageBytes[0] = 0xff;
    imageBytes[1] = 0xd8;
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: () => Promise.resolve(imageBytes.buffer),
    });

    const { request, response } = get(report.id);
    const result = await controller.streetview(
      request,
      response,
      () => undefined,
    );

    // Binary responses return null (app.ts skips res.send) and write to the
    // response directly.
    expect(result).toBeNull();
    expect(response.statusCode).toEqual(200);
    expect(response.getHeader("Content-Type")).toEqual("image/jpeg");
    expect(response.getHeader("Cache-Control")).toContain("max-age=86400");

    // The Google call carries the report's own location, server-side key,
    // and error-code semantics — and nothing else.
    const [url] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(String(url)).toContain(
      "https://maps.googleapis.com/maps/api/streetview?",
    );
    expect(String(url)).toContain(
      `location=${encodeURIComponent("41.79907,-87.58413")}`,
    );
    expect(String(url)).toContain("key=test-streetview-key");
    expect(String(url)).toContain("return-error-code=true");
    expect(String(url)).not.toContain("/reports/");

    // The response body carries the proxied bytes (JPEG SOI marker up front).
    const sent = Buffer.from((response as any)._getData()).toString("hex");
    expect(sent.startsWith("ffd8")).toBe(true);
  });

  test("404s when Street View has no imagery (Google non-200)", async () => {
    const report = await makeReport();

    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    const { request, response } = get(report.id);
    const body = (await controller.streetview(
      request,
      response,
      () => undefined,
    )) as { errors?: string[] };

    expect(response.statusCode).toEqual(404);
    expect(body?.errors).toBeDefined();
  });
});
