import * as http_mocks from "node-mocks-http";

import { FeedObservationsController } from "./FeedObservationsController";
import { FeedObservation } from "../entity/FeedObservation";

type JsonResponse = Record<string, any>;

const controller = new FeedObservationsController();

const authHeaders = (): Record<string, string> => ({
  Authorization: `Basic ${process.env.GOOD_API_KEY}`,
});

// feedflag/observation@1 record shape (snake_case keys, ISO8601 timestamps)
const sampleObservation = (overrides: Record<string, any> = {}) => ({
  domain: "social",
  source_ref: "apify:clockworks/tiktok-scraper#12",
  url: "https://www.tiktok.com/@user123/video/7400000000000000000",
  author: "@user123",
  platform: "tiktok",
  observed_at: "2025-01-15T14:30:00Z",
  posted_at: "2025-01-15T14:00:00Z",
  location: null,
  signal_kind: "poll_line_report",
  wait_minutes: 45,
  wait_category: "45min",
  confidence: 0.92,
  provider: "feedflag",
  relevant: true,
  description: {
    caption: "Long line at polling place",
    image_descriptions: ["people waiting in a line outside a building"],
  },
  ...overrides,
});

const postObservations = async (
  observations: Record<string, any>[],
  headers?: Record<string, string>,
) => {
  const request = http_mocks.createRequest({
    method: "POST",
    body: { observations },
    headers,
  });
  const response = http_mocks.createResponse();
  const body = await controller.create(request, response, () => undefined);
  return { body, response };
};

describe("#create", () => {
  it("returns 401 without auth and inserts nothing", async () => {
    const { body, response } = await postObservations([sampleObservation()]);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
    expect(await FeedObservation.count()).toEqual(0);
  });

  it("returns 400 when observations is missing or empty", async () => {
    const missing = await postObservations(undefined as any, authHeaders());
    expect(missing.response.statusCode).toEqual(400);
    expect((missing.body as JsonResponse).errors[0]).toMatch(
      /observations array is required/,
    );

    const empty = await postObservations([], authHeaders());
    expect(empty.response.statusCode).toEqual(400);
    expect(await FeedObservation.count()).toEqual(0);
  });

  it("inserts observations with auth and reports correct counts", async () => {
    const observations = [
      sampleObservation(),
      sampleObservation({
        domain: "crowd",
        source_ref: "pizzabase:reports/42",
        signal_kind: "user_report",
        wait_minutes: null,
        wait_category: "long",
        platform: null,
        location: { state: "PA", county: "Philadelphia" },
      }),
    ];

    const { body, response } = await postObservations(
      observations,
      authHeaders(),
    );

    expect(response.statusCode).toEqual(200);
    expect(body).toEqual({ inserted: 2, skipped: 0 });

    const saved = await FeedObservation.find({ order: { observedAt: "ASC" } });
    expect(saved.length).toEqual(2);

    expect(saved[0].domain).toEqual("social");
    expect(saved[0].sourceRef).toEqual("apify:clockworks/tiktok-scraper#12");
    expect(saved[0].author).toEqual("@user123");
    expect(saved[0].platform).toEqual("tiktok");
    expect(saved[0].observedAt).toEqual(new Date("2025-01-15T14:30:00Z"));
    expect(saved[0].postedAt).toEqual(new Date("2025-01-15T14:00:00Z"));
    expect(saved[0].signalKind).toEqual("poll_line_report");
    expect(saved[0].waitMinutes).toEqual(45);
    expect(saved[0].waitCategory).toEqual("45min");
    expect(saved[0].confidence).toEqual(0.92);
    expect(saved[0].provider).toEqual("feedflag");
    expect(saved[0].relevant).toEqual(true);
    expect(saved[0].location).toBeNull();
    expect(saved[0].description).toEqual({
      caption: "Long line at polling place",
      image_descriptions: ["people waiting in a line outside a building"],
    });

    expect(saved[1].domain).toEqual("crowd");
    expect(saved[1].sourceRef).toEqual("pizzabase:reports/42");
    expect(saved[1].waitMinutes).toBeNull();
    expect(saved[1].waitCategory).toEqual("long");
    expect(saved[1].platform).toBeNull();
    expect(saved[1].location).toEqual({ state: "PA", county: "Philadelphia" });
  });

  it("inserts observations with omitted nullable fields", async () => {
    const { body } = await postObservations(
      [
        sampleObservation({
          url: undefined,
          author: undefined,
          platform: undefined,
          posted_at: undefined,
          location: undefined,
          wait_minutes: undefined,
          wait_category: undefined,
          provider: undefined,
          relevant: undefined,
        }),
      ],
      authHeaders(),
    );

    expect(body).toEqual({ inserted: 1, skipped: 0 });

    const saved = (await FeedObservation.find())[0];
    expect(saved.url).toBeNull();
    expect(saved.author).toBeNull();
    expect(saved.platform).toBeNull();
    expect(saved.postedAt).toBeNull();
    expect(saved.location).toBeNull();
    expect(saved.waitMinutes).toBeNull();
    expect(saved.waitCategory).toBeNull();
    expect(saved.provider).toBeNull();
    expect(saved.relevant).toBeNull();
  });

  it("skips duplicates on the idempotency key and counts them", async () => {
    const first = sampleObservation({
      source_ref: "apify:clockworks/tiktok-scraper#12",
      observed_at: "2025-01-15T14:30:00Z",
    });
    const second = sampleObservation({
      source_ref: "pizzabase:reports/42",
      observed_at: "2025-01-15T15:00:00Z",
      wait_minutes: 20,
    });
    // Duplicate of `first` — same source_ref + observed_at.
    const duplicate = sampleObservation({
      source_ref: "apify:clockworks/tiktok-scraper#12",
      observed_at: "2025-01-15T14:30:00Z",
      wait_minutes: 999,
    });

    // Load across two requests: 2 new, then 2 new + 1 duplicate.
    const firstLoad = await postObservations([first, second], authHeaders());
    expect(firstLoad.body).toEqual({ inserted: 2, skipped: 0 });

    const reload = await postObservations(
      [first, second, duplicate],
      authHeaders(),
    );
    expect(reload.body).toEqual({ inserted: 0, skipped: 3 });

    // Mixed batch: one genuinely new + one duplicate of the original.
    const mixed = sampleObservation({
      source_ref: "apify:clockworks/tiktok-scraper#13",
      observed_at: "2025-01-15T16:00:00Z",
    });
    const thirdLoad = await postObservations([mixed, duplicate], authHeaders());
    expect(thirdLoad.body).toEqual({ inserted: 1, skipped: 1 });

    // Only 3 distinct rows exist despite 8 posted records.
    expect(await FeedObservation.count()).toEqual(3);
  });

  it("skips duplicates within a single batch", async () => {
    const o = sampleObservation();
    const { body } = await postObservations([o, { ...o }], authHeaders());

    expect(body).toEqual({ inserted: 1, skipped: 1 });
    expect(await FeedObservation.count()).toEqual(1);
  });

  it("keeps same source_ref with different observed_at distinct", async () => {
    const a = sampleObservation({
      source_ref: "apify:clockworks/tiktok-scraper#12",
      observed_at: "2025-01-15T14:30:00Z",
    });
    const b = sampleObservation({
      source_ref: "apify:clockworks/tiktok-scraper#12",
      observed_at: "2025-01-15T15:30:00Z",
    });

    const { body } = await postObservations([a, b], authHeaders());

    expect(body).toEqual({ inserted: 2, skipped: 0 });
    expect(await FeedObservation.count()).toEqual(2);
  });
});

describe("#index", () => {
  const saveObservation = async (overrides: Record<string, any> = {}) => {
    const o = new FeedObservation();
    o.domain = overrides.domain ?? "social";
    o.sourceRef = overrides.sourceRef ?? "apify:clockworks/tiktok-scraper#12";
    o.author = overrides.author ?? "@user123";
    o.platform = overrides.platform ?? "tiktok";
    o.observedAt = overrides.observedAt ?? new Date("2025-01-15T14:30:00Z");
    o.postedAt = overrides.postedAt ?? new Date("2025-01-15T14:00:00Z");
    o.location = overrides.location ?? null;
    o.signalKind = overrides.signalKind ?? "poll_line_report";
    o.waitMinutes = overrides.waitMinutes ?? 45;
    o.waitCategory = overrides.waitCategory ?? "45min";
    o.confidence = overrides.confidence ?? 0.92;
    o.provider = overrides.provider ?? "feedflag";
    o.relevant = overrides.relevant ?? true;
    o.description = overrides.description ?? { caption: "Long line" };
    await o.save();
    return o;
  };

  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({ method: "GET" });
    const response = http_mocks.createResponse();

    const body = await controller.index(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("returns empty list when no observations exist", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.index(request, response, () => undefined);

    expect(body).toEqual({ results: [], count: 0 });
    expect(response.statusCode).toEqual(200);
  });

  it("returns observations newest-first with count", async () => {
    const oldest = await saveObservation({ sourceRef: "ref-a" });
    const middle = await saveObservation({ sourceRef: "ref-b" });
    const newest = await saveObservation({ sourceRef: "ref-c" });

    const request = http_mocks.createRequest({
      method: "GET",
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.index(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.count).toEqual(3);
    expect(body.results.map((r: any) => r.id)).toEqual([
      newest.id,
      middle.id,
      oldest.id,
    ]);
    expect(body.results[0]).toEqual(newest.asJSON());
  });

  it("paginates with limit and page query params", async () => {
    const oldest = await saveObservation({ sourceRef: "ref-a" });
    const middle = await saveObservation({ sourceRef: "ref-b" });
    await saveObservation({ sourceRef: "ref-c" });

    const request = http_mocks.createRequest({
      method: "GET",
      query: { limit: "1", page: "1" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.index(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.count).toEqual(3);
    expect(body.results.length).toEqual(1);
    expect(body.results[0].id).toEqual(middle.id);

    const lastPage = http_mocks.createRequest({
      method: "GET",
      query: { limit: "1", page: "2" },
      headers: authHeaders(),
    });
    const lastBody = (await controller.index(
      lastPage,
      http_mocks.createResponse(),
      () => undefined,
    )) as JsonResponse;
    expect(lastBody.results[0].id).toEqual(oldest.id);
  });
});
