import * as http_mocks from "node-mocks-http";

import { PartnerReportsController } from "./PartnerReportsController";
import { Location } from "../entity/Location";
import { Report } from "../entity/Report";
import { Upload } from "../entity/Upload";
import { Action } from "../entity/Action";
import {
  packPartnerSession,
  unpackPartnerSession,
  PARTNER_EMAILS,
} from "../lib/partners";
import { sendPartnerLoginEmail } from "../lib/mailgun";
import { createStreetViewUpload } from "../lib/streetview";

jest.mock("../lib/validator/geocode");
jest.mock("../lib/mailgun");
jest.mock("../lib/streetview");

const controller = new PartnerReportsController();
const mockedSendPartnerLoginEmail = sendPartnerLoginEmail as jest.Mock;
const mockedCreateStreetViewUpload = createStreetViewUpload as jest.Mock;

const validPartnerToken = async (email = PARTNER_EMAILS[0]) =>
  await packPartnerSession(email);

const authorizedRequest = async (
  body: { [key: string]: unknown },
  email = PARTNER_EMAILS[0],
) =>
  http_mocks.createRequest({
    method: "POST",
    body,
    headers: { Authorization: `Bearer ${await validPartnerToken(email)}` },
  });

describe("PartnerReportsController", () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockedSendPartnerLoginEmail.mockReset().mockResolvedValue(undefined);
    mockedCreateStreetViewUpload.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe("#session", () => {
    test("returns 422 for a missing email", async () => {
      const request = http_mocks.createRequest({ method: "POST", body: {} });
      const response = http_mocks.createResponse();

      const body = await controller.session(request, response, () => undefined);

      expect(response.statusCode).toEqual(422);
      expect(body).toEqual({
        errors: { email: "Whoops! Please enter a valid email address." },
      });
      expect(mockedSendPartnerLoginEmail).not.toHaveBeenCalled();
    });

    test("sends a magic link to an allowlisted partner", async () => {
      const request = http_mocks.createRequest({
        method: "POST",
        body: { email: "NINA@polls.pizza" },
      });
      const response = http_mocks.createResponse();

      const body = await controller.session(request, response, () => undefined);

      expect(response.statusCode).toEqual(200);
      expect(body).toEqual({ success: true });

      expect(mockedSendPartnerLoginEmail).toHaveBeenCalledTimes(1);
      const [to, { link }] = mockedSendPartnerLoginEmail.mock.calls[0];
      // Email normalized to lowercase for the allowlist match
      expect(to).toEqual("nina@polls.pizza");
      // Link points at the partner form on the static site, with a live
      // partner-scoped session token that resolves back to the email
      expect(link).toMatch(
        new RegExp(`^${process.env.STATIC_SITE}/partners/report\\?token=`),
      );
      const token = link.split("?token=")[1];
      expect(await unpackPartnerSession(token)).toEqual("nina@polls.pizza");
    });

    test("returns generic success for a non-allowlisted email, sends nothing", async () => {
      const request = http_mocks.createRequest({
        method: "POST",
        body: { email: "someone@example.com" },
      });
      const response = http_mocks.createResponse();

      const body = await controller.session(request, response, () => undefined);

      expect(response.statusCode).toEqual(200);
      expect(body).toEqual({ success: true });
      expect(mockedSendPartnerLoginEmail).not.toHaveBeenCalled();
    });

    test("surfaces a 500 when Mailgun fails for an allowlisted partner", async () => {
      mockedSendPartnerLoginEmail.mockRejectedValue(new Error("mailgun down"));

      const request = http_mocks.createRequest({
        method: "POST",
        body: { email: PARTNER_EMAILS[0] },
      });
      const response = http_mocks.createResponse();

      const body = await controller.session(request, response, () => undefined);

      expect(response.statusCode).toEqual(500);
      expect(body).toEqual({
        errors: { email: "We can't send emails at this time" },
      });
    });
  });

  describe("#create", () => {
    test("returns 401 without an Authorization header", async () => {
      const request = http_mocks.createRequest({
        method: "POST",
        body: {
          address: "5335 S Kimbark Ave Chicago IL 60615",
          waitTime: "1-2 hours",
        },
      });
      const response = http_mocks.createResponse();

      const body = await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(401);
      expect(body).toEqual({ errors: ["Not authorized"] });
      expect(mockedCreateStreetViewUpload).not.toHaveBeenCalled();
    });

    test("returns 401 for a garbage token", async () => {
      const request = http_mocks.createRequest({
        method: "POST",
        body: {
          address: "5335 S Kimbark Ave Chicago IL 60615",
          waitTime: "1-2 hours",
        },
        headers: { Authorization: "Bearer not-a-token" },
      });
      const response = http_mocks.createResponse();

      await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(401);
    });

    test("creates a trusted report with only address + waitTime, auto-validates, logs the partner", async () => {
      const address = "5335 S Kimbark Ave Chicago IL 60615";
      const request = await authorizedRequest({
        address,
        waitTime: "1-2 hours",
      });
      const response = http_mocks.createResponse();

      const body = await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(200);
      expect(body).toEqual({
        address,
        hasTruck: false,
        willReceive: false,
        alreadyOrdered: false,
      });

      const location = await Location.findOne({
        where: { fullAddress: address },
      });
      expect(location).toBeTruthy();
      expect(location!.validatedAt).toBeTruthy();

      const report = await Report.findOne({
        where: { location: { id: location!.id } },
      });
      expect(report).toBeTruthy();
      // No photo from the partner: validateReport's trusted placeholder URL
      expect(report!.reportURL).toMatch(/^http:\/\/trusted\.url\//);
      // validateReport's trusted defaults for omitted contact info
      expect(report!.contactInfo).toEqual("trusted@example.com");
      expect(report!.contactRole).toEqual("Trusted");
      expect(report!.waitTime).toEqual("1-2 hours");

      const action = await Action.findOne({
        where: { entityId: report!.id, entityType: "Report" },
      });
      expect(action!.userId).toEqual(PARTNER_EMAILS[0]);

      // Street View fallback attempted (mock resolves null here)
      expect(mockedCreateStreetViewUpload).toHaveBeenCalledTimes(1);
      const [svAddress] = mockedCreateStreetViewUpload.mock.calls[0];
      expect(svAddress.fullAddress).toEqual(address);
    });

    test("links the Street View upload when no photo is provided", async () => {
      const address = "5335 S Kimbark Ave Chicago IL 60615";
      const [upload] = await Upload.createOrReject("127.0.0.1", {
        fileExt: "jpg",
        normalizedAddress: {
          latitude: 1234,
          longitude: -1234,
          fullAddress: address,
          address: "5335 S Kimbark Ave",
          city: "Chicago",
          state: "IL",
          zip: "60615",
        },
        fileHash: "aabbccdd",
      });
      mockedCreateStreetViewUpload.mockResolvedValue(upload);

      const request = await authorizedRequest({
        address,
        waitTime: "3+ hours",
      });
      const response = http_mocks.createResponse();

      await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(200);
      const location = await Location.findOne({
        where: { fullAddress: address },
      });
      const report = await Report.findOne({
        where: { location: { id: location!.id } },
        relations: ["upload"],
      });
      expect(report!.upload!.id).toEqual(upload.id);
    });

    test("does not touch Street View when the partner provided media", async () => {
      const address = "5335 S Kimbark Ave Chicago IL 60615";
      const request = await authorizedRequest({
        address,
        waitTime: "1-2 hours",
        url: "https://twitter.com/test/status/456",
        contact: "333-234-2345",
      });
      const response = http_mocks.createResponse();

      await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(200);
      expect(mockedCreateStreetViewUpload).not.toHaveBeenCalled();
      const report = await Report.findOne({
        where: { reportURL: "https://twitter.com/test/status/456" },
      });
      expect(report).toBeTruthy();
    });

    test("returns 422 when waitTime is missing", async () => {
      const request = await authorizedRequest({
        address: "5335 S Kimbark Ave Chicago IL 60615",
      });
      const response = http_mocks.createResponse();

      const body = await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(422);
      expect((body as { errors: { [key: string]: string } }).errors).toEqual({
        waitTime: "Whoops! Can you estimate the wait time?",
      });
      // Structured log: field names only
      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({
          event: "partner_report_validation_failed",
          fields: ["waitTime"],
        }),
      );
    });

    test("returns 422 for a bad address, with field names only in logs", async () => {
      const request = await authorizedRequest({
        address: "not-valid",
        waitTime: "1-2 hours",
      });
      const response = http_mocks.createResponse();

      const body = await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(422);
      expect(Object.keys((body as { errors: object }).errors)).toContain(
        "address",
      );
      const loggedLine = consoleLogSpy.mock.calls
        .map((call) => call[0])
        .find((arg: string) =>
          arg?.includes("partner_report_validation_failed"),
        );
      expect(loggedLine).not.toContain("not-valid");
    });

    test("accepts contact info when provided (optional fields)", async () => {
      const address = "5335 S Kimbark Ave Chicago IL 60615";
      const request = await authorizedRequest({
        address,
        waitTime: "Less than one hour",
        contactFirstName: "Nina",
        contactLastName: "Kadjar",
        contact: "555-234-2345",
        contactRole: "Poll watcher",
      });
      const response = http_mocks.createResponse();

      await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(200);
      const location = await Location.findOne({
        where: { fullAddress: address },
      });
      const report = await Report.findOne({
        where: { location: { id: location!.id } },
      });
      expect(report!.contactFirstName).toEqual("Nina");
      expect(report!.contactLastName).toEqual("Kadjar");
      expect(report!.contactRole).toEqual("Poll watcher");
    });
  });
});
