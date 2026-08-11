import * as http_mocks from "node-mocks-http";

import { BannedPhoneNumbersController } from "./BannedPhoneNumbersController";
import { BannedPhoneNumber } from "../entity/BannedPhoneNumber";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonResponse = Record<string, any>;

const controller = new BannedPhoneNumbersController();

describe("#index", () => {
  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
    });
    const response = http_mocks.createResponse();

    const body = await controller.index(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("returns bans with auth", async () => {
    const ban1 = new BannedPhoneNumber();
    ban1.phoneNumber = "5551234567";
    ban1.reason = "Spam";
    ban1.bannedBy = "admin@example.com";
    await ban1.save();

    const ban2 = new BannedPhoneNumber();
    ban2.phoneNumber = "6669876543";
    ban2.reason = "Harassment";
    ban2.bannedBy = "mod@example.com";
    await ban2.save();

    const request = http_mocks.createRequest({
      method: "GET",
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.index(request, response, () => undefined);

    expect(body).toEqual([
      {
        id: ban2.id,
        phoneNumber: "6669876543",
        reason: "Harassment",
        bannedBy: "mod@example.com",
        bannedAt: ban2.bannedAt,
      },
      {
        id: ban1.id,
        phoneNumber: "5551234567",
        reason: "Spam",
        bannedBy: "admin@example.com",
        bannedAt: ban1.bannedAt,
      },
    ]);
    expect(response.statusCode).toEqual(200);
  });

  it("returns empty list when no bans exist", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.index(request, response, () => undefined);

    expect(body).toEqual([]);
    expect(response.statusCode).toEqual(200);
  });
});

describe("#create", () => {
  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: { phoneNumber: "555-123-4567", reason: "Spam", bannedBy: "admin" },
    });
    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("creates a ban with auth", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        phoneNumber: "555-123-4567",
        reason: "Spam reports",
        bannedBy: "admin@example.com",
      },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = (await controller.create(
      request,
      response,
      () => undefined
    )) as JsonResponse;

    expect(body.phoneNumber).toEqual("5551234567");
    expect(body.reason).toEqual("Spam reports");
    expect(body.bannedBy).toEqual("admin@example.com");
    expect(body.id).toBeTruthy();
    expect(body.bannedAt).toBeTruthy();

    const saved = await BannedPhoneNumber.findOne({
      where: { id: body.id },
    });
    expect(saved).toBeTruthy();
    expect(saved.phoneNumber).toEqual("5551234567");
    expect(saved.reason).toEqual("Spam reports");
    expect(saved.bannedBy).toEqual("admin@example.com");
  });

  it("normalizes phone number on create", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        phoneNumber: "555-234-2345",
        reason: "Test",
        bannedBy: "tester",
      },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = (await controller.create(
      request,
      response,
      () => undefined
    )) as JsonResponse;

    expect(body.phoneNumber).toEqual("5552342345");
  });

  it("rejects duplicate phone number with unique constraint", async () => {
    const existing = new BannedPhoneNumber();
    existing.phoneNumber = "5551234567";
    existing.reason = "First ban";
    existing.bannedBy = "admin";
    await existing.save();

    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        phoneNumber: "5551234567",
        reason: "Second ban",
        bannedBy: "mod",
      },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    await expect(
      controller.create(request, response, () => undefined)
    ).rejects.toThrow();
  });
});

describe("#delete", () => {
  let ban: BannedPhoneNumber;

  beforeEach(async () => {
    ban = new BannedPhoneNumber();
    ban.phoneNumber = "5559876543";
    ban.reason = "Test ban";
    ban.bannedBy = "tester";
    await ban.save();
  });

  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({
      method: "DELETE",
      params: { id: `${ban.id}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.delete(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("removes a ban with auth", async () => {
    const request = http_mocks.createRequest({
      method: "DELETE",
      params: { id: `${ban.id}` },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.delete(request, response, () => undefined);

    expect(body).toEqual({ success: true });
    expect(response.statusCode).toEqual(200);

    const found = await BannedPhoneNumber.findOne({
      where: { id: ban.id },
    });
    expect(found).toBeNull();
  });

  it("returns 404 for nonexistent ban", async () => {
    const request = http_mocks.createRequest({
      method: "DELETE",
      params: { id: "9999999" },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.delete(request, response, () => undefined);

    expect(response.statusCode).toEqual(404);
    expect(body).toBeFalsy();
  });
});
