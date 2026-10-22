import * as http_mocks from "node-mocks-http";
import type { RequestMethod } from "node-mocks-http/lib/http-mock";

import { WaitTimeSourcesController } from "./WaitTimeSourcesController";
import { Location } from "../entity/Location";
import { WaitTimeSource } from "../entity/WaitTimeSource";

const controller = new WaitTimeSourcesController();

// ── Helpers ────────────────────────────────────────────────────────

async function createTestLocation(
  overrides: Partial<Location> = {},
): Promise<Location> {
  const location = new Location();
  location.fullAddress =
    overrides.fullAddress ?? `test-location-${Math.random()}`;
  location.lat = overrides.lat ?? "40.4406";
  location.lng = overrides.lng ?? "-79.9959";
  location.address = overrides.address ?? "1 Test St";
  location.city = overrides.city ?? "Pittsburgh";
  location.state = overrides.state ?? "PA";
  location.zip = overrides.zip ?? "15222";
  location.county =
    overrides.county !== undefined ? overrides.county : "Allegheny";
  await location.save();
  return location;
}

async function createTestSource(
  overrides: Partial<WaitTimeSource> = {},
): Promise<WaitTimeSource> {
  const source = new WaitTimeSource();
  source.scope = overrides.scope ?? "statewide";
  source.state = overrides.state ?? "PA";
  source.county = overrides.county !== undefined ? overrides.county : null;
  source.locationId =
    overrides.locationId !== undefined ? overrides.locationId : null;
  source.url = overrides.url ?? `https://example.com/${Math.random()}`;
  source.sourceType = overrides.sourceType ?? "link";
  source.displayLabel =
    overrides.displayLabel !== undefined ? overrides.displayLabel : null;
  source.isActive =
    overrides.isActive !== undefined ? overrides.isActive : true;
  await source.save();
  return source;
}

function mockRequest(
  options: {
    method?: RequestMethod;
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: Record<string, any>;
    auth?: boolean;
  } = {},
) {
  return http_mocks.createRequest({
    method: options.method || "GET",
    params: options.params || {},
    query: options.query || {},
    body: options.body || {},
    headers: options.auth
      ? { Authorization: `Basic ${process.env.GOOD_API_KEY}` }
      : {},
  });
}

async function run(
  action: (req: any, res: any, next: any) => Promise<any>,
  requestOptions: Parameters<typeof mockRequest>[0],
): Promise<{ status: number; body: any }> {
  const request = mockRequest(requestOptions);
  const response = http_mocks.createResponse();
  const next = jest.fn();

  const body = await action(request, response, next);

  return { status: response.statusCode, body };
}

// ── GET /wait-time-sources (index) ─────────────────────────────────

describe("#index", () => {
  it("is public (no auth required)", async () => {
    const { status } = await run(controller.index.bind(controller), {});

    expect(status).toEqual(200);
  });

  it("returns all active and inactive sources by default", async () => {
    await createTestSource({ url: "https://example.com/idx-active" });
    await createTestSource({
      url: "https://example.com/idx-inactive",
      isActive: false,
    });

    const { body } = await run(controller.index.bind(controller), {
      query: { state: "PA" },
    });

    expect(body.results.length).toBeGreaterThanOrEqual(2);
    expect(body.count).toBeGreaterThanOrEqual(2);
  });

  it("filters by state", async () => {
    await createTestSource({
      scope: "statewide",
      state: "TX",
      url: "https://example.com/tx-only",
    });

    const { body } = await run(controller.index.bind(controller), {
      query: { state: "TX" },
    });

    expect(body.results.length).toBeGreaterThanOrEqual(1);
    for (const source of body.results) {
      expect(source.state).toEqual("TX");
    }
  });

  it("filters by scope", async () => {
    await createTestSource({
      scope: "county",
      state: "PA",
      county: "Allegheny",
      url: "https://example.com/county-only",
    });

    const { body } = await run(controller.index.bind(controller), {
      query: { state: "PA", scope: "county" },
    });

    expect(body.results.length).toBeGreaterThanOrEqual(1);
    for (const source of body.results) {
      expect(source.scope).toEqual("county");
    }
  });

  it("filters by active=true via ?active", async () => {
    await createTestSource({
      state: "PA",
      url: "https://example.com/active-true",
      isActive: true,
    });
    await createTestSource({
      state: "PA",
      url: "https://example.com/active-false",
      isActive: false,
    });

    const { body } = await run(controller.index.bind(controller), {
      query: { state: "PA", active: "true" },
    });

    expect(body.results.length).toBeGreaterThanOrEqual(1);
    for (const source of body.results) {
      expect(source.isActive).toEqual(true);
    }
  });

  it("filters by is_active=false via ?is_active (alias)", async () => {
    await createTestSource({
      state: "PA",
      url: "https://example.com/is-active-false",
      isActive: false,
    });

    const { body } = await run(controller.index.bind(controller), {
      query: { state: "PA", is_active: "false" },
    });

    expect(body.results.length).toBeGreaterThanOrEqual(1);
    for (const source of body.results) {
      expect(source.isActive).toEqual(false);
    }
  });

  it("paginates with limit and page", async () => {
    // Create 5 uniquely identifiable sources
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const url = `https://example.com/page-test-${i}`;
      created.push(url);
      await createTestSource({ state: "PA", url });
    }

    const page1 = await run(controller.index.bind(controller), {
      query: { state: "PA", limit: "2", page: "0" },
    });
    const page2 = await run(controller.index.bind(controller), {
      query: { state: "PA", limit: "2", page: "1" },
    });

    expect(page1.body.results).toHaveLength(2);
    expect(page2.body.results).toHaveLength(2);

    const page1Urls = page1.body.results.map((r: any) => r.url);
    const page2Urls = page2.body.results.map((r: any) => r.url);
    for (const url of page2Urls) {
      expect(page1Urls).not.toContain(url);
    }
  });

  it("caps limit at 100", async () => {
    const { body } = await run(controller.index.bind(controller), {
      query: { state: "PA", limit: "500" },
    });

    expect(body.results.length).toBeLessThanOrEqual(100);
  });
});

// ── GET /locations/:id/wait-time-sources (forLocation) ────────────

describe("#forLocation", () => {
  it("returns 404 for unknown location", async () => {
    // findOr404 sends the 404 body on the response (controller returns undefined)
    const request = mockRequest({ params: { id: "999999" } });
    const response = http_mocks.createResponse();
    const next = jest.fn();
    await controller.forLocation(request, response, next);

    expect(response.statusCode).toEqual(404);
    // repo convention (LinksController.test.ts): _getData() returns the sent object
    expect(response._getData()).toEqual({ errors: ["Not found"] });
  });

  it("matches statewide sources for any location in the state", async () => {
    const location = await createTestLocation({
      state: "PA",
      county: "Allegheny",
    });
    const statewide = await createTestSource({
      scope: "statewide",
      state: "PA",
      url: "https://example.com/pa-statewide",
    });

    const { body } = await run(controller.forLocation.bind(controller), {
      params: { id: String(location.id) },
    });

    expect(body.count).toBeGreaterThanOrEqual(1);
    const urls = body.results.map((r: any) => r.url);
    expect(urls).toContain(statewide.url);
  });

  it("matches county sources only for locations in that county", async () => {
    const inCounty = await createTestLocation({
      state: "PA",
      county: "Allegheny",
    });
    const otherCounty = await createTestLocation({
      state: "PA",
      county: "Philadelphia",
      fullAddress: `other-county-${Math.random()}`,
      city: "Philadelphia",
      zip: "19107",
    });
    const source = await createTestSource({
      scope: "county",
      state: "PA",
      county: "Allegheny",
      url: "https://example.com/allegheny-county",
    });

    const inCountyResult = await run(controller.forLocation.bind(controller), {
      params: { id: String(inCounty.id) },
    });
    expect(inCountyResult.body.results.map((r: any) => r.url)).toContain(
      source.url,
    );

    const otherCountyResult = await run(
      controller.forLocation.bind(controller),
      { params: { id: String(otherCounty.id) } },
    );
    expect(otherCountyResult.body.results.map((r: any) => r.url)).not.toContain(
      source.url,
    );
  });

  it("matches location-scoped sources only for the exact location", async () => {
    const location = await createTestLocation({
      state: "PA",
      county: "Allegheny",
    });
    const otherLocation = await createTestLocation({
      state: "PA",
      county: "Allegheny",
      fullAddress: `another-location-${Math.random()}`,
    });
    const source = await createTestSource({
      scope: "location",
      state: "PA",
      locationId: location.id,
      url: "https://example.com/exact-location",
    });

    const own = await run(controller.forLocation.bind(controller), {
      params: { id: String(location.id) },
    });
    expect(own.body.results.map((r: any) => r.url)).toContain(source.url);

    const other = await run(controller.forLocation.bind(controller), {
      params: { id: String(otherLocation.id) },
    });
    expect(other.body.results.map((r: any) => r.url)).not.toContain(source.url);
  });

  it("excludes sources from other states", async () => {
    const location = await createTestLocation({
      state: "PA",
      county: "Allegheny",
    });
    await createTestSource({
      scope: "county",
      state: "TX",
      county: "Allegheny",
      url: "https://example.com/wrong-state",
    });

    const { body } = await run(controller.forLocation.bind(controller), {
      params: { id: String(location.id) },
    });

    const urls = body.results.map((r: any) => r.url);
    expect(urls).not.toContain("https://example.com/wrong-state");
  });

  it("excludes inactive sources", async () => {
    const location = await createTestLocation({
      state: "PA",
      county: "Allegheny",
    });
    await createTestSource({
      scope: "county",
      state: "PA",
      county: "Allegheny",
      url: "https://example.com/inactive-source",
      isActive: false,
    });

    const { body } = await run(controller.forLocation.bind(controller), {
      params: { id: String(location.id) },
    });

    const urls = body.results.map((r: any) => r.url);
    expect(urls).not.toContain("https://example.com/inactive-source");
  });

  it("orders sources location → county → statewide", async () => {
    // Use a unique state/county so other tests' sources can't pollute the
    // exact ordering assertion (the test DB is shared across the suite).
    const location = await createTestLocation({
      state: "QZ",
      county: "Quartz",
      fullAddress: `order-test-${Math.random()}`,
      city: "Quartzville",
      zip: "99999",
    });
    await createTestSource({
      scope: "statewide",
      state: "QZ",
      url: "https://example.com/order-statewide",
    });
    await createTestSource({
      scope: "county",
      state: "QZ",
      county: "Quartz",
      url: "https://example.com/order-county",
    });
    await createTestSource({
      scope: "location",
      state: "QZ",
      locationId: location.id,
      url: "https://example.com/order-location",
    });

    const { body } = await run(controller.forLocation.bind(controller), {
      params: { id: String(location.id) },
    });

    const scopes = body.results.map((r: any) => r.scope);
    expect(scopes).toEqual(["location", "county", "statewide"]);
  });

  it("deduplicates by URL keeping the highest-priority scope", async () => {
    const location = await createTestLocation({
      state: "PA",
      county: "Allegheny",
    });
    const sharedUrl = "https://example.com/shared-dedup-url";

    // Same URL at county and statewide scope — county should win (comes first)
    await createTestSource({
      scope: "statewide",
      state: "PA",
      url: sharedUrl,
    });
    await createTestSource({
      scope: "county",
      state: "PA",
      county: "Allegheny",
      url: sharedUrl,
    });

    const { body } = await run(controller.forLocation.bind(controller), {
      params: { id: String(location.id) },
    });

    const matching = body.results.filter((r: any) => r.url === sharedUrl);
    expect(matching).toHaveLength(1);
    expect(matching[0].scope).toEqual("county");
  });

  it("returns an empty result set when no sources exist for the state", async () => {
    const location = await createTestLocation({
      state: "ZZ",
      county: null,
      fullAddress: `no-sources-${Math.random()}`,
    });

    const { body } = await run(controller.forLocation.bind(controller), {
      params: { id: String(location.id) },
    });

    expect(body.count).toEqual(0);
    expect(body.results).toEqual([]);
  });
});

// ── POST /wait-time-sources (create) ───────────────────────────────

describe("#create", () => {
  const validBody = {
    scope: "statewide",
    state: "PA",
    url: "https://example.com/new-statewide",
    source_type: "link",
    display_label: "New Statewide Portal",
  };

  it("returns 401 without auth", async () => {
    const { status, body } = await run(controller.create.bind(controller), {
      method: "POST",
      body: validBody,
    });

    expect(status).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("creates a statewide source with valid auth", async () => {
    const { status, body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: validBody,
    });

    expect(status).toEqual(200);
    expect(body.scope).toEqual("statewide");
    expect(body.state).toEqual("PA");
    expect(body.url).toEqual("https://example.com/new-statewide");
    expect(body.isActive).toEqual(true);
    expect(body.county).toBeNull();
    expect(body.locationId).toBeNull();

    const saved = await WaitTimeSource.findOne({ where: { id: body.id } });
    expect(saved).toBeTruthy();
    expect(saved!.url).toEqual("https://example.com/new-statewide");
  });

  it("creates a county source", async () => {
    const { body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: {
        scope: "county",
        state: "PA",
        county: "Allegheny",
        url: "https://example.com/new-county",
      },
    });

    expect(body.scope).toEqual("county");
    expect(body.county).toEqual("Allegheny");
    expect(body.locationId).toBeNull();
  });

  it("creates a location source", async () => {
    const location = await createTestLocation();
    const { body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: {
        scope: "location",
        state: "PA",
        location_id: location.id,
        url: "https://example.com/new-location",
      },
    });

    expect(body.scope).toEqual("location");
    expect(body.locationId).toEqual(location.id);
    expect(body.county).toBeNull();
  });

  it("rejects statewide scope when county is set (422)", async () => {
    const { status, body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: { ...validBody, county: "Allegheny" },
    });

    expect(status).toEqual(422);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors.join(" ")).toMatch(/county must not be set/i);
  });

  it("rejects statewide scope when location_id is set (422)", async () => {
    const { status, body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: { ...validBody, location_id: 1 },
    });

    expect(status).toEqual(422);
    expect(body.errors.join(" ")).toMatch(/location_id must not be set/i);
  });

  it("rejects county scope without county (422)", async () => {
    const { status, body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: {
        scope: "county",
        state: "PA",
        url: "https://example.com/no-county",
      },
    });

    expect(status).toEqual(422);
    expect(body.errors.join(" ")).toMatch(/county is required/i);
  });

  it("rejects location scope without location_id (422)", async () => {
    const { status, body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: {
        scope: "location",
        state: "PA",
        url: "https://example.com/no-location",
      },
    });

    expect(status).toEqual(422);
    expect(body.errors.join(" ")).toMatch(/location_id is required/i);
  });

  it("rejects invalid scope values (422)", async () => {
    const { status, body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: {
        scope: "precinct",
        state: "PA",
        url: "https://example.com/bad-scope",
      },
    });

    expect(status).toEqual(422);
    expect(body.errors.join(" ")).toMatch(/invalid scope/i);
  });

  it("rejects missing url (422)", async () => {
    const { status, body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: { scope: "statewide", state: "PA" },
    });

    expect(status).toEqual(422);
    expect(body.errors.join(" ")).toMatch(/url is required/i);
  });

  it("rejects missing or invalid state (422)", async () => {
    const { status, body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: { scope: "statewide", url: "https://example.com/no-state" },
    });

    expect(status).toEqual(422);
    expect(body.errors.join(" ")).toMatch(/state is required/i);
  });

  it("rejects invalid source_type (422)", async () => {
    const { status, body } = await run(controller.create.bind(controller), {
      method: "POST",
      auth: true,
      body: { ...validBody, source_type: "carrier-pigeon" },
    });

    expect(status).toEqual(422);
    expect(body.errors.join(" ")).toMatch(/invalid source_type/i);
  });
});

// ── PUT /wait-time-sources/:id (update) ────────────────────────────

describe("#update", () => {
  it("returns 401 without auth", async () => {
    const source = await createTestSource();
    const { status, body } = await run(controller.update.bind(controller), {
      method: "PUT",
      params: { id: String(source.id) },
      body: { is_active: false },
    });

    expect(status).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("returns 404 for unknown id", async () => {
    const { status } = await run(controller.update.bind(controller), {
      method: "PUT",
      auth: true,
      params: { id: "999999" },
      body: { is_active: false },
    });

    expect(status).toEqual(404);
  });

  it("toggles is_active", async () => {
    const source = await createTestSource({ isActive: true });

    const { body } = await run(controller.update.bind(controller), {
      method: "PUT",
      auth: true,
      params: { id: String(source.id) },
      body: { is_active: false },
    });

    expect(body.isActive).toEqual(false);

    const saved = await WaitTimeSource.findOne({ where: { id: source.id } });
    expect(saved!.isActive).toEqual(false);
  });

  it("sets last_verified_at", async () => {
    const source = await createTestSource();
    const verifiedAt = "2024-11-05T14:00:00.000Z";

    const { body } = await run(controller.update.bind(controller), {
      method: "PUT",
      auth: true,
      params: { id: String(source.id) },
      body: { last_verified_at: verifiedAt },
    });

    expect(body.lastVerifiedAt).toBeTruthy();
    expect(new Date(body.lastVerifiedAt).toISOString()).toEqual(verifiedAt);
  });

  it("updates display_label and notes", async () => {
    const source = await createTestSource();

    const { body } = await run(controller.update.bind(controller), {
      method: "PUT",
      auth: true,
      params: { id: String(source.id) },
      body: {
        display_label: "Updated Label",
        notes: "Updated notes",
      },
    });

    expect(body.displayLabel).toEqual("Updated Label");
    expect(body.notes).toEqual("Updated notes");
  });

  it("rejects invalid source_type on update (422)", async () => {
    const source = await createTestSource();

    const { status, body } = await run(controller.update.bind(controller), {
      method: "PUT",
      auth: true,
      params: { id: String(source.id) },
      body: { source_type: "fax" },
    });

    expect(status).toEqual(422);
    expect(body.errors.join(" ")).toMatch(/invalid source_type/i);
  });

  it("rejects scope-breaking updates (422) without persisting", async () => {
    const source = await createTestSource({
      scope: "statewide",
      state: "PA",
      url: "https://example.com/scope-break",
    });

    // Switching a statewide source to county without setting county → invalid
    const { status, body } = await run(controller.update.bind(controller), {
      method: "PUT",
      auth: true,
      params: { id: String(source.id) },
      body: { scope: "county" },
    });

    expect(status).toEqual(422);
    expect(body.errors.join(" ")).toMatch(/county is required/i);

    // Verify nothing was persisted
    const saved = await WaitTimeSource.findOne({ where: { id: source.id } });
    expect(saved!.scope).toEqual("statewide");
  });

  it("allows a valid scope transition (statewide → county)", async () => {
    const source = await createTestSource({
      scope: "statewide",
      state: "PA",
    });

    const { body } = await run(controller.update.bind(controller), {
      method: "PUT",
      auth: true,
      params: { id: String(source.id) },
      body: { scope: "county", county: "Allegheny" },
    });

    expect(body.scope).toEqual("county");
    expect(body.county).toEqual("Allegheny");
  });
});

// ── DELETE /wait-time-sources/:id (destroy, soft-delete) ──────────

describe("#destroy", () => {
  it("returns 401 without auth", async () => {
    const source = await createTestSource();
    const { status, body } = await run(controller.destroy.bind(controller), {
      method: "DELETE",
      params: { id: String(source.id) },
    });

    expect(status).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("returns 404 for unknown id", async () => {
    const { status } = await run(controller.destroy.bind(controller), {
      method: "DELETE",
      auth: true,
      params: { id: "999999" },
    });

    expect(status).toEqual(404);
  });

  it("soft-deletes by setting is_active=false (row preserved)", async () => {
    const source = await createTestSource();

    const { status, body } = await run(controller.destroy.bind(controller), {
      method: "DELETE",
      auth: true,
      params: { id: String(source.id) },
    });

    expect(status).toEqual(200);
    expect(body.success).toEqual(true);

    // Row still exists, marked inactive
    const saved = await WaitTimeSource.findOne({ where: { id: source.id } });
    expect(saved).toBeTruthy();
    expect(saved!.isActive).toEqual(false);

    // A second destroy returns 404 (already inactive)
    const second = await run(controller.destroy.bind(controller), {
      method: "DELETE",
      auth: true,
      params: { id: String(source.id) },
    });
    expect(second.status).toEqual(404);
  });

  it("excludes soft-deleted sources from forLocation results", async () => {
    const location = await createTestLocation({
      state: "PA",
      county: "Allegheny",
    });
    const source = await createTestSource({
      scope: "county",
      state: "PA",
      county: "Allegheny",
      url: "https://example.com/destroyed-source",
    });

    await run(controller.destroy.bind(controller), {
      method: "DELETE",
      auth: true,
      params: { id: String(source.id) },
    });

    const { body } = await run(controller.forLocation.bind(controller), {
      params: { id: String(location.id) },
    });

    const urls = body.results.map((r: any) => r.url);
    expect(urls).not.toContain("https://example.com/destroyed-source");
  });
});
