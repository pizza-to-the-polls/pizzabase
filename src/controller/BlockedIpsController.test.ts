import * as http_mocks from "node-mocks-http";

import { BlockedIpsController } from "./BlockedIpsController";
import { BlockedIp } from "../entity/BlockedIp";
import { ipHash } from "../lib/ip-blocklist";
import { updateWafIpSet } from "../lib/waf";

// `updateWafIpSet` is mocked so controller tests can assert the edge-sync
// contract without AWS calls. The real function never throws (verified in
// waf.test.ts); the default mock mirrors that best-effort contract.
jest.mock("../lib/waf", () => ({
  updateWafIpSet: jest.fn(),
}));

const mockUpdateWafIpSet = updateWafIpSet as unknown as jest.Mock;

type JsonResponse = Record<string, any>;

const controller = new BlockedIpsController();

// FEAT-007: the WAF IP set ARN gates the edge-sync path. Tests default to
// the env unset (skip) and opt in per test; restored in afterAll.
const ORIGINAL_WAF_ARN = process.env.WAF_BLOCKED_IPSET_ARN;
const withWafEnabled = () => {
  process.env.WAF_BLOCKED_IPSET_ARN =
    "arn:aws:wafv2:us-west-2:320802729995" +
    ":regional/ipset/ptp-blocked-ips/da0493ec-7c55-4082-8d4d-f080f41a468b";
};

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
  beforeEach(() => {
    delete process.env.WAF_BLOCKED_IPSET_ARN;
    mockUpdateWafIpSet.mockReset().mockResolvedValue(true);
  });

  afterAll(() => {
    if (ORIGINAL_WAF_ARN === undefined) {
      delete process.env.WAF_BLOCKED_IPSET_ARN;
    } else {
      process.env.WAF_BLOCKED_IPSET_ARN = ORIGINAL_WAF_ARN;
    }
  });
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

  describe("WAF edge sync (FEAT-007)", () => {
    const authHeaders = () => ({
      Authorization: `Basic ${process.env.GOOD_API_KEY}`,
    });

    it("skips the edge sync when WAF_BLOCKED_IPSET_ARN is unset (helper resolves false)", async () => {
      // The env-unset skip lives inside updateWafIpSet (verified against the
      // real implementation in waf.test.ts): it performs no AWS calls and
      // resolves false. The mock mirrors that skip contract here.
      mockUpdateWafIpSet.mockResolvedValue(false);
      const request = http_mocks.createRequest({
        method: "POST",
        body: { ip: "192.0.2.10", reason: "Spam", blockedBy: "admin" },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      await controller.create(request, response, () => undefined);

      expect(mockUpdateWafIpSet).toHaveBeenCalledWith("192.0.2.10", "ADD");
      expect(await BlockedIp.isBlocked("192.0.2.10")).toBe(true);
    });

    it("adds the raw IP to the WAF IP set when the ARN is set", async () => {
      withWafEnabled();
      const request = http_mocks.createRequest({
        method: "POST",
        body: { ip: "192.0.2.10", reason: "Spam", blockedBy: "admin" },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      const body = await controller.create(request, response, () => undefined);

      expect(mockUpdateWafIpSet).toHaveBeenCalledTimes(1);
      expect(mockUpdateWafIpSet).toHaveBeenCalledWith("192.0.2.10", "ADD");
      expect(response.statusCode).toEqual(200);
      // Raw IP never appears in the API response — hash only.
      expect(JSON.stringify(body)).not.toContain("192.0.2.10");
    });

    it("still succeeds when the WAF update fails (best-effort)", async () => {
      withWafEnabled();
      // Mirrors the real helper's failure contract: resolves false, never
      // throws (the real client exception is caught inside waf.ts).
      mockUpdateWafIpSet.mockResolvedValue(false);
      const request = http_mocks.createRequest({
        method: "POST",
        body: { ip: "192.0.2.10", reason: "Spam", blockedBy: "admin" },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      const body = (await controller.create(
        request,
        response,
        () => undefined,
      )) as JsonResponse;

      expect(response.statusCode).toEqual(200);
      expect(body.ipHash).toEqual(ipHash("192.0.2.10"));
      expect(await BlockedIp.isBlocked("192.0.2.10")).toBe(true);
    });
  });
});

describe("#delete", () => {
  let block: BlockedIp;

  beforeEach(async () => {
    delete process.env.WAF_BLOCKED_IPSET_ARN;
    mockUpdateWafIpSet.mockReset().mockResolvedValue(true);

    block = new BlockedIp();
    block.ipHash = ipHash("192.0.2.14");
    block.reason = "Test block";
    block.blockedBy = "tester";
    await block.save();
  });

  afterAll(() => {
    if (ORIGINAL_WAF_ARN === undefined) {
      delete process.env.WAF_BLOCKED_IPSET_ARN;
    } else {
      process.env.WAF_BLOCKED_IPSET_ARN = ORIGINAL_WAF_ARN;
    }
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

  describe("WAF edge sync (FEAT-007)", () => {
    const authHeaders = () => ({
      Authorization: `Basic ${process.env.GOOD_API_KEY}`,
    });

    it("skips the edge sync when WAF_BLOCKED_IPSET_ARN is unset (helper resolves false)", async () => {
      // Same contract as the create-side skip test: the helper itself skips
      // when the env var is unset (see waf.test.ts); the mock mirrors that
      // by resolving false.
      mockUpdateWafIpSet.mockResolvedValue(false);
      const request = http_mocks.createRequest({
        method: "DELETE",
        params: { id: `${block.id}` },
        body: { ip: "192.0.2.14" },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      await controller.delete(request, response, () => undefined);

      expect(mockUpdateWafIpSet).toHaveBeenCalledWith("192.0.2.14", "REMOVE");
      expect(await BlockedIp.isBlocked("192.0.2.14")).toBe(false);
    });

    it("removes the raw IP from the WAF IP set when supplied with the ARN set", async () => {
      withWafEnabled();
      const request = http_mocks.createRequest({
        method: "DELETE",
        params: { id: `${block.id}` },
        body: { ip: "192.0.2.14" },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      const body = await controller.delete(request, response, () => undefined);

      expect(mockUpdateWafIpSet).toHaveBeenCalledTimes(1);
      expect(mockUpdateWafIpSet).toHaveBeenCalledWith("192.0.2.14", "REMOVE");
      expect(body).toEqual({ success: true });
      expect(await BlockedIp.isBlocked("192.0.2.14")).toBe(false);
    });

    it("accepts any equivalent form of the blocked IP", async () => {
      withWafEnabled();
      const request = http_mocks.createRequest({
        method: "DELETE",
        params: { id: `${block.id}` },
        // Different raw form, same normalized address → same hash.
        body: { ip: "::ffff:192.0.2.14" },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      await controller.delete(request, response, () => undefined);

      expect(mockUpdateWafIpSet).toHaveBeenCalledWith(
        "::ffff:192.0.2.14",
        "REMOVE",
      );
    });

    it("still unblocks when the WAF update fails (best-effort)", async () => {
      withWafEnabled();
      mockUpdateWafIpSet.mockResolvedValue(false);
      const request = http_mocks.createRequest({
        method: "DELETE",
        params: { id: `${block.id}` },
        body: { ip: "192.0.2.14" },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      const body = await controller.delete(request, response, () => undefined);

      expect(body).toEqual({ success: true });
      expect(await BlockedIp.isBlocked("192.0.2.14")).toBe(false);
    });

    it("skips the WAF update and warns when no raw IP is supplied", async () => {
      withWafEnabled();
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const request = http_mocks.createRequest({
        method: "DELETE",
        params: { id: `${block.id}` },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      const body = await controller.delete(request, response, () => undefined);

      expect(body).toEqual({ success: true });
      expect(mockUpdateWafIpSet).not.toHaveBeenCalled();
      expect(await BlockedIp.isBlocked("192.0.2.14")).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      // The warning cannot reference the missing address (there is none).
      expect(consoleWarnSpy.mock.calls[0].join(" ")).not.toContain("192.0.2");
      consoleWarnSpy.mockRestore();
    });

    it("skips the WAF update when the supplied IP does not match the entry", async () => {
      withWafEnabled();
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const request = http_mocks.createRequest({
        method: "DELETE",
        params: { id: `${block.id}` },
        body: { ip: "192.0.2.99" },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      await controller.delete(request, response, () => undefined);

      // A mismatched address must never be removed from the edge set.
      expect(mockUpdateWafIpSet).not.toHaveBeenCalled();
      expect(await BlockedIp.isBlocked("192.0.2.14")).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      // The mismatched address is never echoed into the logs.
      expect(consoleWarnSpy.mock.calls[0].join(" ")).not.toContain("192.0.2");
      consoleWarnSpy.mockRestore();
    });

    it("does not warn about a missing IP when the ARN is unset", async () => {
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const request = http_mocks.createRequest({
        method: "DELETE",
        params: { id: `${block.id}` },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      await controller.delete(request, response, () => undefined);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(mockUpdateWafIpSet).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });
});
