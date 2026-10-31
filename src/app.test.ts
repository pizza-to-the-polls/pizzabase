/**
 * Route-scoped body limits (feedflag #76, pizzabase half).
 *
 * The bulk observation intake carries description JSONB blobs. A single
 * fat-but-valid observation near the default 100kb body limit was rejected
 * BY THE MIDDLEWARE — a 413 at the door, before the controller could log or
 * dedupe it — so an oversized row could never land even with a sender that
 * batches perfectly. /feed-observations now gets a 512kb limit scoped to its
 * prefix; every other route keeps the default.
 *
 * Uses the real express app and node:http (NOT fetch — jest.setup mocks
 * globalThis.fetch for the controller suites). No auth: the discriminating
 * behaviour happens before authorization — 401 proves the body reached a
 * controller; 413 proves body-parser rejected it first.
 */
import http from "node:http";
import dbHelper from "./tests/dbHelper";
import app from "./app";

const postJSON = (port: number, path: string, body: string) =>
  new Promise<{ status: number }>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        res.resume(); // drain so the socket frees
        resolve({ status: res.statusCode ?? 0 });
      },
    );
    req.on("error", reject);
    req.end(body);
  });

/** A ~150kb JSON body — over the 100kb default, under the 512kb route limit. */
const fatBody = JSON.stringify({
  observations: [
    {
      domain: "social",
      source_ref: "synthetic-fat-row",
      observed_at: new Date().toISOString(),
      signal_kind: "poll_line_report",
      confidence: 0.9,
      description: { caption: "x".repeat(150_000) },
    },
  ],
});

describe("body limits (feedflag #76)", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    // The house pattern (maxWorkers: 1, one shared DataSource): every suite
    // that can touch the DB initializes it through setUpDB. The auth checks
    // behind these POSTs query the APIKey repository, which lazily
    // initializes the DataSource with testConfig's dropSchema:true — doing
    // that OUTSIDE setUpDB's controlled path dropped the schema mid-run for
    // every suite after this one. (Learned the hard way: 20 suites red.)
    await dbHelper.setUpDB();
  });

  beforeAll((done) => {
    server = app.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      done();
    });
  });

  afterAll((done) => {
    server.close(() => done());
  });

  it("accepts a 150kb body on /feed-observations (reaches the controller, 401 unauthenticated)", async () => {
    const r = await postJSON(port, "/feed-observations", fatBody);
    expect(r.status).toEqual(401);
  });

  it("still rejects the same body on routes with the default limit (413 at the middleware)", async () => {
    const r = await postJSON(port, "/order", fatBody);
    expect(r.status).toEqual(413);
  });

  it("still accepts small bodies everywhere", async () => {
    const feed = await postJSON(port, "/feed-observations", "{}");
    expect(feed.status).toEqual(401);
    // /order is a POST route under the DEFAULT limit: a small body passes
    // the middleware and reaches the controller's auth check.
    const order = await postJSON(port, "/order", "{}");
    expect(order.status).toEqual(401);
  });
});
