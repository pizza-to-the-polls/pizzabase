import { EventEmitter } from "events";

import * as http_mocks from "node-mocks-http";

import { requestLogging } from "./requestLogging";

describe("requestLogging", () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // node-mocks-http's default mock response inherits from a no-op
  // EventEmitter stub, so registered listeners never fire. Passing Node's
  // real EventEmitter via the supported `eventEmitter` option lets us drive
  // the middleware's actual `res.on("finish", ...)` behavior with
  // `res.emit("finish")`.
  const createResponse = () =>
    http_mocks.createResponse({ eventEmitter: EventEmitter });

  it("registers exactly one finish listener and calls next", () => {
    const req = http_mocks.createRequest({ method: "GET", url: "/health" });
    const res = createResponse();
    const next = jest.fn();

    requestLogging(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.listenerCount("finish")).toEqual(1);
  });

  it("logs method, route pattern, status, and duration for a 200", () => {
    const req = http_mocks.createRequest({ method: "GET", url: "/health" });
    const res = createResponse();
    const next = jest.fn();

    requestLogging(req, res, next);

    // Simulate the route closure in app.ts capturing the registered pattern
    // and the controller finishing the response.
    (req as any).routePattern = "/health";
    res.statusCode = 200;
    res.emit("finish");

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(parsed).toEqual({
      event: "http_request",
      method: "get",
      route: "/health",
      status: 200,
      durationMs: expect.any(Number),
    });
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("logs a 422 validation failure status", () => {
    const req = http_mocks.createRequest({
      method: "POST",
      url: "/reports",
    });
    const res = createResponse();
    const next = jest.fn();

    requestLogging(req, res, next);

    (req as any).routePattern = "/reports";
    res.statusCode = 422;
    res.emit("finish");

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(parsed).toMatchObject({
      event: "http_request",
      method: "post",
      route: "/reports",
      status: 422,
    });
  });

  it("uses the registered route pattern instead of the raw URL", () => {
    const req = http_mocks.createRequest({
      method: "GET",
      url: "/locations/123-main-st-chicago-il?include=order",
    });
    const res = createResponse();
    const next = jest.fn();

    requestLogging(req, res, next);

    (req as any).routePattern = "/locations/:idOrAddress";
    res.emit("finish");

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(parsed.route).toEqual("/locations/:idOrAddress");
  });

  it("falls back to req.path with the query string stripped", () => {
    const req = http_mocks.createRequest({
      method: "POST",
      url: "/reports/123?secret_token=abc",
    });
    const res = createResponse();
    const next = jest.fn();

    requestLogging(req, res, next);

    // No routePattern set — the middleware must fall back to req.path,
    // which strips the query string (no tokens in the logs).
    res.emit("finish");

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(parsed.route).toEqual("/reports/123");
    expect(parsed.route).not.toContain("secret_token");
  });

  it("never logs request or response bodies or other PII", () => {
    const req = http_mocks.createRequest({
      method: "POST",
      url: "/reports",
      body: {
        contact: "555-234-2345",
        contactFirstName: "Jim",
        address: "5335 S Kimbark Ave Chicago IL 60615",
      },
    });
    const res = createResponse();
    const next = jest.fn();

    requestLogging(req, res, next);

    (req as any).routePattern = "/reports";
    (res as any).body = { errors: { contact: "bad" } };
    res.emit("finish");

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).not.toContain("555-234-2345");
    expect(output).not.toContain("Jim");
    expect(output).not.toContain("5335 S Kimbark Ave");
    expect(output).not.toContain("bad");

    const parsed = JSON.parse(output);
    expect(Object.keys(parsed)).toEqual([
      "event",
      "method",
      "route",
      "status",
      "durationMs",
    ]);
  });
});
