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

  // BUG-019: epoch-millis / non-ISO timestamps previously flowed verbatim
  // into $n::TIMESTAMPTZ bind params, so Postgres threw SQLState 22008 and
  // the whole batch 500'd. The endpoint now normalizes timestamps and
  // rejects malformed observed_at with a 400 naming the row index.
  describe("BUG-019 timestamp normalization", () => {
    const EPOCH_MS = 1792642500000; // the value from the prod Bugsnag report
    const expectedInstant = new Date(EPOCH_MS);

    it("inserts posted_at given as an epoch-millis string as the ISO instant", async () => {
      const { body, response } = await postObservations(
        [sampleObservation({ posted_at: String(EPOCH_MS) })],
        authHeaders(),
      );

      expect(response.statusCode).toEqual(200);
      expect(body).toEqual({ inserted: 1, skipped: 0 });
      const saved = (await FeedObservation.find())[0];
      expect(saved.postedAt).toEqual(expectedInstant);
      // observed_at passed through ISO unchanged.
      expect(saved.observedAt).toEqual(new Date("2025-01-15T14:30:00Z"));
    });

    it("inserts posted_at given as an epoch-millis number as the same instant", async () => {
      const { body, response } = await postObservations(
        [sampleObservation({ posted_at: EPOCH_MS })],
        authHeaders(),
      );

      expect(response.statusCode).toEqual(200);
      expect(body).toEqual({ inserted: 1, skipped: 0 });
      const saved = (await FeedObservation.find())[0];
      expect(saved.postedAt).toEqual(expectedInstant);
    });

    it("inserts observed_at given as an epoch-millis string, normalized", async () => {
      const { body, response } = await postObservations(
        [sampleObservation({ observed_at: String(EPOCH_MS) })],
        authHeaders(),
      );

      expect(response.statusCode).toEqual(200);
      expect(body).toEqual({ inserted: 1, skipped: 0 });
      const saved = (await FeedObservation.find())[0];
      expect(saved.observedAt).toEqual(expectedInstant);
    });

    it("keeps idempotency when observed_at is epoch-millis: re-post reports inserted 0", async () => {
      const batch = [
        sampleObservation({
          source_ref: "apify:clockworks/tiktok-scraper#12",
          observed_at: String(EPOCH_MS),
        }),
        sampleObservation({
          source_ref: "apify:clockworks/tiktok-scraper#13",
          observed_at: String(EPOCH_MS),
        }),
      ];

      const first = await postObservations(batch, authHeaders());
      expect(first.body).toEqual({ inserted: 2, skipped: 0 });

      const reload = await postObservations(batch, authHeaders());
      expect(reload.body).toEqual({ inserted: 0, skipped: 2 });
      expect(await FeedObservation.count()).toEqual(2);
    });

    it("returns 400 naming the row index for an unparseable observed_at", async () => {
      const { body, response } = await postObservations(
        [sampleObservation({ observed_at: "not-a-date" })],
        authHeaders(),
      );

      expect(response.statusCode).toEqual(400);
      expect((body as JsonResponse).errors).toEqual([
        'observations[0].observed_at is not a valid timestamp: "not-a-date"',
      ]);
      expect(await FeedObservation.count()).toEqual(0);
    });

    it("inserts nothing and names the offending row when one row in a batch is invalid", async () => {
      const { body, response } = await postObservations(
        [
          sampleObservation({ source_ref: "ref-good" }),
          sampleObservation({
            source_ref: "ref-bad",
            observed_at: "17926425000",
          }), // 11 digits, not epoch-ms
          sampleObservation({ source_ref: "ref-also-good" }),
        ],
        authHeaders(),
      );

      expect(response.statusCode).toEqual(400);
      expect((body as JsonResponse).errors).toEqual([
        'observations[1].observed_at is not a valid timestamp: "17926425000"',
      ]);
      expect(await FeedObservation.count()).toEqual(0);
    });

    it("returns 400 for observed_at as epoch-seconds string (not epoch-ms magnitude)", async () => {
      // Per the helper's contract, digit-only strings are only interpreted
      // as epoch-millis at 12-14 digits; an 11-digit string is unparseable.
      const { body, response } = await postObservations(
        [sampleObservation({ observed_at: "17926425000" })],
        authHeaders(),
      );

      expect(response.statusCode).toEqual(400);
      expect((body as JsonResponse).errors[0]).toMatch(
        /observations\[0\]\.observed_at is not a valid timestamp/,
      );
      expect(await FeedObservation.count()).toEqual(0);
    });

    it("returns 400 for observed_at epoch-ms beyond the 14-digit range", async () => {
      const { response } = await postObservations(
        [sampleObservation({ observed_at: "17926425000000000" })],
        authHeaders(),
      );

      expect(response.statusCode).toEqual(400);
      expect(await FeedObservation.count()).toEqual(0);
    });

    it("returns 400 when observed_at is null or missing", async () => {
      const nullCase = await postObservations(
        [sampleObservation({ observed_at: null })],
        authHeaders(),
      );
      expect(nullCase.response.statusCode).toEqual(400);
      expect((nullCase.body as JsonResponse).errors[0]).toMatch(
        /observations\[0\]\.observed_at is not a valid timestamp: null/,
      );

      const missingCase = await postObservations(
        [sampleObservation({ observed_at: undefined })],
        authHeaders(),
      );
      expect(missingCase.response.statusCode).toEqual(400);
      expect(await FeedObservation.count()).toEqual(0);
    });

    it("still inserts when posted_at is null or omitted (regression)", async () => {
      const nullPosted = await postObservations(
        [sampleObservation({ source_ref: "ref-null-posted", posted_at: null })],
        authHeaders(),
      );
      expect(nullPosted.response.statusCode).toEqual(200);
      expect(nullPosted.body).toEqual({ inserted: 1, skipped: 0 });

      const omittedPosted = await postObservations(
        [
          sampleObservation({
            source_ref: "ref-omitted-posted",
            posted_at: undefined,
          }),
        ],
        authHeaders(),
      );
      expect(omittedPosted.response.statusCode).toEqual(200);
      expect(omittedPosted.body).toEqual({ inserted: 1, skipped: 0 });

      const saved = await FeedObservation.find({ order: { id: "ASC" } });
      expect(saved.map((o) => o.postedAt)).toEqual([null, null]);
    });

    it("returns 400 naming the row index when wait_minutes is not an integer", async () => {
      const { body, response } = await postObservations(
        [sampleObservation({ wait_minutes: "forty-five" })],
        authHeaders(),
      );

      expect(response.statusCode).toEqual(400);
      expect((body as JsonResponse).errors).toEqual([
        'observations[0].wait_minutes must be an integer: "forty-five"',
      ]);
      expect(await FeedObservation.count()).toEqual(0);
    });
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

// ── GET /feed-observations/summary (feedflag #69: the digest reads the DB) ──
//
// The summary is what the daily findings digest consumes instead of
// data/observations.jsonl (which the feedflag runner empties after every
// successful emit). These tests pin the contract the digest depends on:
// distinct (domain, source_ref) counting, the flag rule, the hot-govt
// latest-reading semantics, window boundaries, and — because the digest is
// the durable daily surface — that the endpoint never emits PII.

describe("#summary", () => {
  const getSummary = async (
    query: Record<string, string> = {},
    headers?: Record<string, string>,
  ) => {
    const request = http_mocks.createRequest({
      method: "GET",
      url: "/feed-observations/summary",
      query,
      headers: headers ?? authHeaders(),
    });
    const response = http_mocks.createResponse();
    const body = await controller.summary(request, response, () => undefined);
    return { body: body as JsonResponse, response };
  };

  const isoAgo = (hours: number) =>
    new Date(Date.now() - hours * 3600 * 1000).toISOString();

  it("returns 401 without auth", async () => {
    const { body, response } = await getSummary({}, {});
    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("rejects a future or unparseable since, a bad min_confidence, and a negative hot_wait_minutes", async () => {
    const future = await getSummary({
      since: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    expect(future.response.statusCode).toEqual(400);
    expect(future.body.errors[0]).toMatch(/since must be an ISO timestamp/);

    const junk = await getSummary({ since: "not a date" });
    expect(junk.response.statusCode).toEqual(400);

    const badConf = await getSummary({ min_confidence: "1.5" });
    expect(badConf.response.statusCode).toEqual(400);
    expect(badConf.body.errors[0]).toMatch(/min_confidence/);

    const badHot = await getSummary({ hot_wait_minutes: "-5" });
    expect(badHot.response.statusCode).toEqual(400);
  });

  it("counts distinct (domain, source_ref) pairs — three rows for one source are one observation, and the domain counts sum to the total", async () => {
    await postObservations(
      [
        // One social source with three readings in-window → ONE observation.
        sampleObservation({ observed_at: isoAgo(1) }),
        sampleObservation({ observed_at: isoAgo(2) }),
        sampleObservation({ observed_at: isoAgo(3) }),
        // One govt source with two readings.
        sampleObservation({
          domain: "govt",
          source_ref: "govt:clark-nv#P-2",
          signal_kind: "wait_time_reading",
          author: "Clark NV Wait Times",
          wait_minutes: 45,
          wait_category: "45min",
          observed_at: isoAgo(1),
        }),
        sampleObservation({
          domain: "govt",
          source_ref: "govt:clark-nv#P-2",
          signal_kind: "wait_time_reading",
          author: "Clark NV Wait Times",
          wait_minutes: 50,
          wait_category: "50min",
          observed_at: isoAgo(2),
        }),
        // One crowd report.
        sampleObservation({
          domain: "crowd",
          source_ref: "pizzabase:reports/9",
          signal_kind: "user_report",
          observed_at: isoAgo(1),
        }),
      ],
      authHeaders(),
    );

    const since = isoAgo(26);
    const { body } = await getSummary({ since });
    expect(body.total_observations).toEqual(3);
    expect(body.social_rows).toEqual(1);
    expect(body.govt_rows).toEqual(1);
    expect(body.crowd_rows).toEqual(1);
    expect(
      (body.social_rows as number) +
        (body.govt_rows as number) +
        (body.crowd_rows as number),
    ).toEqual(body.total_observations);
    // by_signal_kind counts pairs too: 3 readings of the sample's kind are 1.
    const kinds = Object.fromEntries(
      (body.by_signal_kind as { kind: string; count: number }[]).map(
        (k) => [k.kind, k.count] as [string, number],
      ),
    );
    expect(kinds["poll_line_report"]).toEqual(1);
    expect(kinds["wait_time_reading"]).toEqual(1);
    expect(kinds["user_report"]).toEqual(1);
  });

  it("flags mirror shouldFlag: relevant + confidence >= threshold + category filter, and flag_categories omitted means all categories", async () => {
    await postObservations(
      [
        // Flagged: social, relevant, 0.92, in-category.
        sampleObservation({
          source_ref: "apify:flagged#1",
          observed_at: isoAgo(1),
        }),
        // Not flagged: below threshold.
        sampleObservation({
          source_ref: "apify:below#2",
          confidence: 0.4,
          observed_at: isoAgo(1),
        }),
        // Not flagged: relevant=false at high confidence.
        sampleObservation({
          source_ref: "apify:irrelevant#3",
          relevant: false,
          signal_kind: "irrelevant",
          observed_at: isoAgo(1),
        }),
        // Not flagged: in-flagCategories terms, wrong category for the filter.
        sampleObservation({
          source_ref: "apify:wrongcat#4",
          signal_kind: "press_mention",
          observed_at: isoAgo(1),
        }),
      ],
      authHeaders(),
    );

    // No flag_categories → every category is eligible: 2 flagged
    // (the 0.92 poll_line_report + the 0.99-category press_mention).
    const all = await getSummary({
      since: isoAgo(26),
      min_confidence: "0.7",
    });
    expect(all.body.flagged_count).toEqual(2);
    expect(
      (all.body.flagged_recent as { source_ref: string }[]).map(
        (f) => f.source_ref,
      ),
    ).toEqual(expect.arrayContaining(["apify:flagged#1", "apify:wrongcat#4"]));

    // With the digest's category filter, press_mention is archive-only → 1.
    const filtered = await getSummary({
      since: isoAgo(26),
      min_confidence: "0.7",
      flag_categories: "poll_line_report",
    });
    expect(filtered.body.flagged_count).toEqual(1);
    expect(
      (filtered.body.flagged_recent as { source_ref: string }[]).map(
        (f) => f.source_ref,
      ),
    ).toEqual(["apify:flagged#1"]);

    // An explicitly EMPTY flag_categories means "no filter", not "no flags".
    const emptyList = await getSummary({
      since: isoAgo(26),
      min_confidence: "0.7",
      flag_categories: "",
    });
    expect(emptyList.body.flagged_count).toEqual(2);
  });

  it("hot_govt counts sources whose LATEST in-window reading is hot — an earlier hot reading that has since cooled does not count", async () => {
    await postObservations(
      [
        // Hot and still hot: latest reading 75.
        sampleObservation({
          domain: "govt",
          source_ref: "govt:still-hot#1",
          signal_kind: "wait_time_reading",
          author: "Still Hot County",
          wait_minutes: 75,
          observed_at: isoAgo(1),
        }),
        // Was hot, has cooled: latest reading 10 (the 90 is older).
        sampleObservation({
          domain: "govt",
          source_ref: "govt:cooled#2",
          signal_kind: "wait_time_reading",
          author: "Cooled County",
          wait_minutes: 90,
          observed_at: isoAgo(4),
        }),
        sampleObservation({
          domain: "govt",
          source_ref: "govt:cooled#2",
          signal_kind: "wait_time_reading",
          author: "Cooled County",
          wait_minutes: 10,
          observed_at: isoAgo(1),
        }),
        // Never hot.
        sampleObservation({
          domain: "govt",
          source_ref: "govt:cool#3",
          signal_kind: "wait_time_reading",
          author: "Cool County",
          wait_minutes: 5,
          observed_at: isoAgo(1),
        }),
      ],
      authHeaders(),
    );

    const { body } = await getSummary({
      since: isoAgo(26),
      hot_wait_minutes: "60",
    });
    expect(body.govt_source_count).toEqual(3);
    expect(body.hot_govt_count).toEqual(1);
  });

  it("honours the window boundary: observations older than since are excluded entirely", async () => {
    await postObservations(
      [
        sampleObservation({
          source_ref: "apify:old#1",
          observed_at: isoAgo(48),
        }),
        sampleObservation({
          source_ref: "apify:new#1",
          observed_at: isoAgo(1),
        }),
      ],
      authHeaders(),
    );

    const { body } = await getSummary({ since: isoAgo(26) });
    expect(body.total_observations).toEqual(1);
  });

  it("returns no PII: flagged_recent carries no caption, author, or description text", async () => {
    await postObservations(
      [
        sampleObservation({
          source_ref: "apify:pii#1",
          author: "@someone",
          observed_at: isoAgo(1),
          description: {
            caption: "call me at 555-0100 to coordinate",
            imageDescriptions: ["a photo of a line"],
          },
        }),
      ],
      authHeaders(),
    );

    const { body } = await getSummary({ since: isoAgo(26) });
    const flat = JSON.stringify(body.flagged_recent);
    expect(flat).not.toMatch(/555-0100/);
    expect(flat).not.toMatch(/@someone/);
    expect(flat).not.toMatch(/caption|description/i);
    // The flagged row carries identity-free fields only.
    expect(body.flagged_recent[0]).toEqual(
      expect.objectContaining({ source_ref: "apify:pii#1" }),
    );
    expect(Object.keys(body.flagged_recent[0]).sort()).toEqual(
      [
        "confidence",
        "observed_at",
        "platform",
        "signal_kind",
        "source_ref",
        "url",
      ].sort(),
    );
  });
});
