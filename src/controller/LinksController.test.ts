import * as http_mocks from "node-mocks-http";

import { LinksController } from "./LinksController";
import { Link } from "../entity/Link";
import { LinkClick } from "../entity/LinkClick";
import { notifyBugsnag } from "../lib/notifyBugsnag";

jest.mock("../lib/notifyBugsnag", () => ({
  notifyBugsnag: jest.fn(),
}));

type JsonResponse = Record<string, any>;

const controller = new LinksController();

// ── Helpers ────────────────────────────────────────────────────────

async function createTestLink(overrides: Partial<Link> = {}): Promise<Link> {
  const link = new Link();
  link.slug = overrides.slug ?? Link.generateSlug();
  link.targetUrl = overrides.targetUrl ?? "https://example.com/test";
  link.campaignTag = overrides.campaignTag ?? "test-campaign";
  link.clipId = overrides.clipId ?? null;
  await link.save();
  return link;
}

// ── GET /l/:slug (redirect) ────────────────────────────────────────

describe("#redirect", () => {
  it("redirects 302 to the target URL and records a click", async () => {
    const link = await createTestLink({
      slug: "abcDE",
      targetUrl: "https://polls.pizza/donate",
    });

    const request = http_mocks.createRequest({
      method: "GET",
      params: { slug: "abcDE" },
      headers: {
        "user-agent": "Mozilla/5.0 TestBrowser",
        referer: "https://twitter.com/",
      },
    });
    const response = http_mocks.createResponse();

    await controller.redirect(request, response, () => undefined);

    expect(response.statusCode).toEqual(302);
    expect(response._getRedirectUrl()).toEqual("https://polls.pizza/donate");

    // Click should be recorded (async but fast in test with single worker)
    // Give it a small tick to settle
    await new Promise((r) => setTimeout(r, 50));

    const clicks = await LinkClick.find({
      where: { link: { id: link.id } },
    });
    expect(clicks).toHaveLength(1);
    expect(clicks[0].userAgent).toEqual("Mozilla/5.0 TestBrowser");
    expect(clicks[0].referer).toEqual("https://twitter.com/");
  });

  it("returns 404 for a non-existent slug", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      params: { slug: "ZZZZZ" },
    });
    const response = http_mocks.createResponse();
    const next = jest.fn();

    await controller.redirect(request, response, next);

    expect(response.statusCode).toEqual(404);
    const body = response._getData();
    expect(body).toEqual({ errors: ["Short link not found"] });
  });

  it("still redirects when click insert fails (fail-open)", async () => {
    await createTestLink({
      slug: "failX",
      targetUrl: "https://example.com/ok",
    });

    // Make LinkClick.prototype.save throw to simulate a DB failure
    const origSave = LinkClick.prototype.save;
    try {
      LinkClick.prototype.save = jest
        .fn()
        .mockRejectedValue(new Error("connection refused"));

      const request = http_mocks.createRequest({
        method: "GET",
        params: { slug: "failX" },
      });
      const response = http_mocks.createResponse();

      await controller.redirect(request, response, () => undefined);

      // Still redirects despite the click failure
      expect(response.statusCode).toEqual(302);
      expect(response._getRedirectUrl()).toEqual("https://example.com/ok");

      // Bugsnag notified about the loss
      expect(notifyBugsnag).toHaveBeenCalled();
    } finally {
      LinkClick.prototype.save = origSave;
    }
  });

  it("handles missing optional headers gracefully", async () => {
    const link = await createTestLink({
      slug: "noHdr",
      targetUrl: "https://example.com/minimal",
    });

    const request = http_mocks.createRequest({
      method: "GET",
      params: { slug: "noHdr" },
    });
    const response = http_mocks.createResponse();

    await controller.redirect(request, response, () => undefined);

    expect(response.statusCode).toEqual(302);

    await new Promise((r) => setTimeout(r, 50));
    const clicks = await LinkClick.find({
      where: { link: { id: link.id } },
    });
    expect(clicks).toHaveLength(1);
    expect(clicks[0].userAgent).toBeNull();
    expect(clicks[0].referer).toBeNull();
  });
});

// ── POST /links (create) ───────────────────────────────────────────

describe("#create", () => {
  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        targetUrl: "https://example.com",
        campaignTag: "test-campaign",
      },
    });
    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("creates a link with valid auth and required fields", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        targetUrl: "https://polls.pizza/clip-42",
        campaignTag: "clip-42-tiktok",
        clipId: 42,
      },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = (await controller.create(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.slug).toMatch(/^[a-zA-Z0-9]{5}$/);
    expect(body.targetUrl).toEqual("https://polls.pizza/clip-42");
    expect(body.campaignTag).toEqual("clip-42-tiktok");
    expect(body.clipId).toEqual(42);
    expect(body.id).toBeTruthy();
    expect(body.createdAt).toBeTruthy();

    // Verify persisted
    const saved = await Link.findOne({ where: { id: body.id } });
    expect(saved).toBeTruthy();
    expect(saved!.slug).toEqual(body.slug);
    expect(saved!.targetUrl).toEqual("https://polls.pizza/clip-42");
    expect(saved!.campaignTag).toEqual("clip-42-tiktok");
    expect(saved!.clipId).toEqual(42);
  });

  it("creates a link without clipId (nullable)", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: {
        targetUrl: "https://example.com/bio",
        campaignTag: "bio-instagram",
      },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = (await controller.create(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.slug).toMatch(/^[a-zA-Z0-9]{5}$/);
    expect(body.clipId).toBeNull();
    expect(body.campaignTag).toEqual("bio-instagram");
  });

  it("returns 400 when targetUrl is missing", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: { campaignTag: "test" },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(response.statusCode).toEqual(400);
    expect(body).toEqual({ errors: ["targetUrl is required"] });
  });

  it("returns 400 when campaignTag is missing", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: { targetUrl: "https://example.com" },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(response.statusCode).toEqual(400);
    expect(body).toEqual({ errors: ["campaignTag is required"] });
  });

  it("generates unique slugs on repeated calls", async () => {
    const slugs = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const request = http_mocks.createRequest({
        method: "POST",
        body: {
          targetUrl: `https://example.com/${i}`,
          campaignTag: "slug-test",
        },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      });
      const response = http_mocks.createResponse();

      const body = (await controller.create(
        request,
        response,
        () => undefined,
      )) as JsonResponse;

      expect(response.statusCode).toEqual(200);
      expect(slugs.has(body.slug)).toBe(false);
      slugs.add(body.slug);
    }
  });
});

// ── GET /links/:slug/clicks ────────────────────────────────────────

describe("#clicks", () => {
  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      params: { slug: "abcDE" },
    });
    const response = http_mocks.createResponse();

    const body = await controller.clicks(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("returns 404 for unknown slug", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      params: { slug: "ZZZZZ" },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    await controller.clicks(request, response, () => undefined);

    expect(response.statusCode).toEqual(404);
  });

  it("returns count and recent clicks with auth", async () => {
    const link = await createTestLink({
      slug: "clkMe",
      targetUrl: "https://example.com/tracked",
    });

    // Create clicks with different timestamps and data
    const click1 = new LinkClick();
    click1.link = link;
    click1.userAgent = "Bot/1.0";
    click1.referer = "https://t.co/abc";
    await click1.save();

    const click2 = new LinkClick();
    click2.link = link;
    click2.userAgent = "Mozilla/5.0";
    click2.referer = null;
    await click2.save();

    const request = http_mocks.createRequest({
      method: "GET",
      params: { slug: "clkMe" },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = (await controller.clicks(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.count).toEqual(2);
    expect(body.recent).toHaveLength(2);
    // Most recent first
    expect(body.recent[0].userAgent).toEqual("Mozilla/5.0");
    expect(body.recent[0].referer).toBeNull();
    expect(body.recent[0].clickedAt).toBeTruthy();
    expect(body.recent[1].userAgent).toEqual("Bot/1.0");
    expect(body.recent[1].referer).toEqual("https://t.co/abc");
  });

  it("returns zero count and empty recent for a link with no clicks", async () => {
    await createTestLink({
      slug: "noClk",
      targetUrl: "https://example.com/quiet",
    });

    const request = http_mocks.createRequest({
      method: "GET",
      params: { slug: "noClk" },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = (await controller.clicks(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.count).toEqual(0);
    expect(body.recent).toEqual([]);
  });

  it("limits recent clicks to 50", async () => {
    const link = await createTestLink({
      slug: "manyCk",
      targetUrl: "https://example.com/busy",
    });

    // Create 55 clicks
    for (let i = 0; i < 55; i++) {
      const click = new LinkClick();
      click.link = link;
      click.userAgent = `Agent/${i}`;
      await click.save();
    }

    const request = http_mocks.createRequest({
      method: "GET",
      params: { slug: "manyCk" },
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
    const response = http_mocks.createResponse();

    const body = (await controller.clicks(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.count).toEqual(55);
    expect(body.recent).toHaveLength(50);
  });
});

// ── Slug generation (pure unit tests) ──────────────────────────────

describe("Link.generateSlug", () => {
  it("produces a 5-character base62 string", () => {
    for (let i = 0; i < 100; i++) {
      const slug = Link.generateSlug();
      expect(slug).toHaveLength(5);
      expect(slug).toMatch(/^[a-zA-Z0-9]{5}$/);
    }
  });
});

describe("Link.createWithSlug", () => {
  it("returns a persisted link with a valid slug", async () => {
    const link = await Link.createWithSlug({
      targetUrl: "https://example.com",
      campaignTag: "test",
    });

    expect(link.id).toBeTruthy();
    expect(link.slug).toMatch(/^[a-zA-Z0-9]{5}$/);
    expect(link.targetUrl).toEqual("https://example.com");
    expect(link.campaignTag).toEqual("test");
    expect(link.clipId).toBeNull();
  });

  it("retries on slug collision until it succeeds", async () => {
    // Force generateSlug to return the same slug several times, then a unique one
    const origGenerateSlug = Link.generateSlug;
    let callCount = 0;
    try {
      Link.generateSlug = jest.fn(() => {
        callCount++;
        if (callCount <= 3) return "aaaAA"; // collides repeatedly
        return `uniq${callCount}`.slice(0, 5); // unique slug
      });

      // First link takes the colliding slug
      const existing = new Link();
      existing.slug = "aaaAA";
      existing.targetUrl = "https://example.com/existing";
      existing.campaignTag = "blocker";
      await existing.save();

      // This call should retry and eventually succeed
      const link = await Link.createWithSlug({
        targetUrl: "https://example.com/new",
        campaignTag: "retry-test",
      });

      expect(link.id).toBeTruthy();
      expect(link.slug).not.toEqual("aaaAA");
      expect(callCount).toBeGreaterThan(1);
    } finally {
      Link.generateSlug = origGenerateSlug;
    }
  });

  it("passes through non-23505 errors immediately", async () => {
    // Mock save to throw a non-unique-constraint error
    const origSave = Link.prototype.save;
    try {
      Link.prototype.save = jest
        .fn()
        .mockRejectedValue(new Error("connection timeout"));

      await expect(
        Link.createWithSlug({
          targetUrl: "https://example.com",
          campaignTag: "test",
        }),
      ).rejects.toThrow("connection timeout");
    } finally {
      Link.prototype.save = origSave;
    }
  });

  it("throws after exhausting retries with persistent collision", async () => {
    // Force generateSlug to always return same slug
    const origGenerateSlug = Link.generateSlug;
    try {
      Link.generateSlug = jest.fn().mockReturnValue("aaaAA");

      const existing = new Link();
      existing.slug = "aaaAA";
      existing.targetUrl = "https://example.com/existing";
      existing.campaignTag = "blocker";
      await existing.save();

      await expect(
        Link.createWithSlug({
          targetUrl: "https://example.com/retry",
          campaignTag: "retry-test",
        }),
      ).rejects.toThrow("Failed to generate unique slug");
    } finally {
      Link.generateSlug = origGenerateSlug;
    }
  });
});
