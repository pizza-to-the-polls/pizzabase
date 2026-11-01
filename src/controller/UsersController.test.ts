import * as http_mocks from "node-mocks-http";

import { UsersController } from "./UsersController";
import { User } from "../entity/User";
import { Report } from "../entity/Report";

jest.mock("../lib/validator/geocode");

const controller = new UsersController();

type Method = "GET" | "POST" | "PUT" | "DELETE";

const authedRequest = (
  method: Method,
  { body = {}, id }: { body?: object; id?: string } = {},
) => {
  const request = http_mocks.createRequest({
    method,
    body,
    headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
  });
  request.params = id ? { id } : {};
  return request;
};

const seedUser = async (email: string) => {
  const user = new User();
  user.email = email;
  user.firstName = "Jane";
  user.organization = "Common Cause";
  user.admin = false;
  await user.save();
  return user;
};

describe("UsersController", () => {
  // jest.setup.ts afterEach already truncates every entity table
  // (dbHelper.cleanAll) between tests.

  describe("auth", () => {
    test("index returns 401 without an API key", async () => {
      const request = http_mocks.createRequest({ method: "GET" });
      const response = http_mocks.createResponse();

      await controller.index(request, response, () => undefined);

      expect(response.statusCode).toEqual(401);
    });

    test("create returns 401 without an API key", async () => {
      const request = http_mocks.createRequest({
        method: "POST",
        body: { email: "jane@example.com" },
      });
      const response = http_mocks.createResponse();

      await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(401);
      expect(await User.count()).toEqual(0);
    });
  });

  describe("#create", () => {
    test("creates a user, normalizing the email", async () => {
      const request = authedRequest("POST", {
        body: {
          email: "JANE@Example.com",
          firstName: "Jane",
          organization: "Common Cause",
        },
      });
      const response = http_mocks.createResponse();

      const body = await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(201);
      expect(body).toMatchObject({
        email: "jane@example.com",
        firstName: "Jane",
        organization: "Common Cause",
        admin: false,
      });
      expect(
        await User.findOne({ where: { email: "jane@example.com" } }),
      ).toBeTruthy();
    });

    test("rejects a duplicate email with the existing id", async () => {
      const existing = await seedUser("jane@example.com");
      const request = authedRequest("POST", {
        body: { email: "jane@example.com" },
      });
      const response = http_mocks.createResponse();

      const body = (await controller.create(
        request,
        response,
        () => undefined,
      )) as { errors: { email: string } };

      expect(response.statusCode).toEqual(422);
      expect(body.errors.email).toContain("already has a user");
      expect(body.errors.email).toContain(String(existing.id));
      expect(await User.count()).toEqual(1);
    });

    test("rejects an invalid email", async () => {
      const request = authedRequest("POST", {
        body: { email: "not-an-email" },
      });
      const response = http_mocks.createResponse();

      await controller.create(request, response, () => undefined);

      expect(response.statusCode).toEqual(422);
      expect(await User.count()).toEqual(0);
    });
  });

  describe("#index and #show", () => {
    test("lists and shows users", async () => {
      await seedUser("jane@example.com");
      await seedUser("pat@example.com");

      const listResponse = http_mocks.createResponse();
      const list = (await controller.index(
        authedRequest("GET"),
        listResponse,
        () => undefined,
      )) as { results: { email: string }[]; count: number };
      expect(listResponse.statusCode).toEqual(200);
      expect(list.count).toEqual(2);
      expect(list.results.map((u) => u.email).sort()).toEqual([
        "jane@example.com",
        "pat@example.com",
      ]);

      const user = await User.findOne({ where: { email: "jane@example.com" } });
      const showResponse = http_mocks.createResponse();
      const shown = (await controller.show(
        authedRequest("GET", { id: String(user!.id) }),
        showResponse,
        () => undefined,
      )) as { email: string };
      expect(showResponse.statusCode).toEqual(200);
      expect(shown.email).toEqual("jane@example.com");
    });

    test("show 404s for an unknown id", async () => {
      const response = http_mocks.createResponse();
      const body = await controller.show(
        authedRequest("GET", { id: "9999999" }),
        response,
        () => undefined,
      );

      expect(response.statusCode).toEqual(404);
      expect(body).toBeNull();
    });
  });

  describe("#update", () => {
    test("updates fields and guards email uniqueness", async () => {
      const jane = await seedUser("jane@example.com");
      await seedUser("pat@example.com");

      const updateRequest = authedRequest("PUT", {
        body: { organization: "Pizza to the Polls", admin: true },
        id: String(jane.id),
      });
      const updateResponse = http_mocks.createResponse();
      const updated = (await controller.update(
        updateRequest,
        updateResponse,
        () => undefined,
      )) as { organization: string; admin: boolean };
      expect(updateResponse.statusCode).toEqual(200);
      expect(updated.organization).toEqual("Pizza to the Polls");
      expect(updated.admin).toEqual(true);

      const conflictRequest = authedRequest("PUT", {
        body: { email: "pat@example.com" },
        id: String(jane.id),
      });
      const conflictResponse = http_mocks.createResponse();
      const conflict = (await controller.update(
        conflictRequest,
        conflictResponse,
        () => undefined,
      )) as { errors: { email: string } };
      expect(conflictResponse.statusCode).toEqual(422);
      expect(conflict.errors.email).toContain(
        "already belongs to another user",
      );
    });
  });

  describe("#remove", () => {
    test("deletes a user and nulls their reports' trusted_by (SET NULL)", async () => {
      const user = await seedUser("jane@example.com");
      const [report] = await Report.createNewReport(
        "555-234-2345",
        "http://twitter.com/test/status/777",
        {
          latitude: 41.79907,
          longitude: -87.58413,
          fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
          address: "5335 S Kimbark Ave",
          city: "Chicago",
          state: "IL",
          zip: "60615",
        },
      );
      report.trustedBy = user;
      await report.save();

      const response = http_mocks.createResponse();
      const body = await controller.remove(
        authedRequest("DELETE", { id: String(user.id) }),
        response,
        () => undefined,
      );

      expect(response.statusCode).toEqual(200);
      expect(body).toEqual({ success: true });
      expect(await User.count()).toEqual(0);

      const after = await Report.findOne({
        where: { id: report.id },
        relations: ["trustedBy"],
      });
      // FK is ON DELETE SET NULL: the report survives, attribution is nulled.
      expect(after!.trustedBy).toBeNull();
    });
  });
});
