import * as http_mocks from "node-mocks-http";

import { BlockedIpsController } from "./BlockedIpsController";
import { BlockedIp } from "../entity/BlockedIp";
import { ipHash } from "../lib/ip-blocklist";

type JsonResponse = Record<string, any>;

const controller = new BlockedIpsController();

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

  it("returns blocks with auth", async () => {
    const block1 = new BlockedIp();
    block1.ipHash = ipHash("192.0.2.1");
    block1.reason = "Spam";
    block1.blockedBy = "admin@example.com";
    await block1.save();

    const block2 = new BlockedIp();
    block2.ipHash = ipHash("192.0.2.2");
    block2.reason = "Fake reports";
    block2.blockedBy = "mod@example.com";
    await block2.save();

    const request = http_mocks.createRequest({
      method: "GET",
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.index(request, response, () => undefined);

    expect(body).toEqual({
      results: [
        {
          id: block2.id,
          ipHash: ipHash("192.0.2.2"),
          reason: "Fake reports",
          blockedBy: "mod@example.com",
          blockedAt: block2.blockedAt,
        },
        {
          id: block1.id,
          ipHash: ipHash("192.0.2.1"),
          reason: "Spam",
          blockedBy: "admin@example.com",
          blockedAt: block1.blockedAt,
        },
      ],
      count: 2,
    });
    expect(response.statusCode).toEqual(200);
  });

  it("returns empty list when no blocks exist", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.index(request, response, () => undefined);

    expect(body).toEqual({ results: [], count: 0 });
    expect(response.statusCode).toEqual(200);
  });

  it("paginates with limit and page query params", async () => {
    const block1 = new BlockedIp();
    block1.ipHash = ipHash("192.0.2.1");
    block1.reason = "Spam";
    await block1.save();

    const block2 = new BlockedIp();
    block2.ipHash = ipHash("192.0.2.2");
    block2.reason = "Fake reports";
    await block2.save();

    const request = http_mocks.createRequest({
      method: "GET",
      query: { limit: "1", page: "1" },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = (await controller.index(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.count).toEqual(2);
    expect(body.results.length).toEqual(1);
    expect(body.results[0].id).toEqual(block1.id);
  });
});

describe("#show", () => {
  let block: BlockedIp;

  beforeEach(async () => {
    block = new BlockedIp();
    block.ipHash = ipHash("192.0.2.7");
    block.reason = "Spam reports";
    block.blockedBy = "admin@example.com";
    await block.save();
  });

  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      params: { idOrIpHash: `${block.id}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.show(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("returns a block by id", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      params: { idOrIpHash: `${block.id}` },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.show(request, response, () => undefined);

    expect(body).toEqual(block.asJSON());
    expect(response.statusCode).toEqual(200);
  });

  it("returns a block by its stored hash", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      params: { idOrIpHash: ipHash("192.0.2.7") },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.show(request, response, () => undefined);

    expect(body).toEqual(block.asJSON());
    expect(response.statusCode).toEqual(200);
  });

  it("returns 404 for a nonexistent block", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      params: { idOrIpHash: ipHash("192.0.2.99") },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.show(request, response, () => undefined);

    expect(response.statusCode).toEqual(404);
    expect(body).toBeFalsy();
  });
});

describe("#create", () => {
  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: { ip: "192.0.2.10", reason: "Spam", blockedBy: "admin" },
    });
    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("creates a block with auth and stores only the hash", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        ip: "192.0.2.10",
        reason: "Spam reports",
        blockedBy: "admin@example.com",
      },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = (await controller.create(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.ipHash).toEqual(ipHash("192.0.2.10"));
    expect(body.reason).toEqual("Spam reports");
    expect(body.blockedBy).toEqual("admin@example.com");
    expect(body.id).toBeTruthy();
    expect(body.blockedAt).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("192.0.2.10");

    const saved = await BlockedIp.findOne({ where: { id: body.id } });
    expect(saved.ipHash).toEqual(ipHash("192.0.2.10"));
  });

  it("normalizes a mapped IPv6 form on create so it hashes to the same entry", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: { ip: "::ffff:192.0.2.11", reason: "Test", blockedBy: "tester" },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = (await controller.create(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.ipHash).toEqual(ipHash("192.0.2.11"));
    expect(await BlockedIp.isBlocked("192.0.2.11")).toBe(true);
  });

  it("rejects unparseable IPs with 422", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: { ip: "not-an-ip", reason: "Test", blockedBy: "tester" },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(response.statusCode).toEqual(422);
    expect(body).toEqual({ errors: { ip: "Not a valid IP address" } });
    expect(await BlockedIp.count()).toEqual(0);
  });

  it("rejects duplicate hashes with unique constraint", async () => {
    const existing = new BlockedIp();
    existing.ipHash = ipHash("192.0.2.12");
    existing.reason = "First block";
    await existing.save();

    const request = http_mocks.createRequest({
      method: "POST",
      // Same IP via a different form → same hash → unique constraint fires.
      body: {
        ip: "::ffff:192.0.2.12",
        reason: "Second block",
        blockedBy: "mod",
      },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    await expect(
      controller.create(request, response, () => undefined),
    ).rejects.toThrow();
  });
});

describe("#delete", () => {
  let block: BlockedIp;

  beforeEach(async () => {
    block = new BlockedIp();
    block.ipHash = ipHash("192.0.2.14");
    block.reason = "Test block";
    block.blockedBy = "tester";
    await block.save();
  });

  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({
      method: "DELETE",
      params: { id: `${block.id}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.delete(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("removes a block with auth", async () => {
    const request = http_mocks.createRequest({
      method: "DELETE",
      params: { id: `${block.id}` },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.delete(request, response, () => undefined);

    expect(body).toEqual({ success: true });
    expect(response.statusCode).toEqual(200);

    const found = await BlockedIp.findOne({ where: { id: block.id } });
    expect(found).toBeNull();
    expect(await BlockedIp.isBlocked("192.0.2.14")).toBe(false);
  });

  it("returns 404 for nonexistent block", async () => {
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
