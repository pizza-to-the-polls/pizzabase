import * as http_mocks from "node-mocks-http";

import { ClipsController } from "./ClipsController";
import { invokeRenderClip } from "../lib/clip-render";
import { notifyClipKit } from "../lib/clipKit";
import { Clip, ClipStatus } from "../entity/Clip";
import { Link } from "../entity/Link";
import { Location } from "../entity/Location";
import { Upload } from "../entity/Upload";

// Prevent actual Lambda invocations during tests.
jest.mock("../lib/clip-render", () => ({
  invokeRenderClip: jest.fn().mockResolvedValue(undefined),
}));

// Slack kit distribution is tested in src/lib/clipKit.test.ts — here it is
// mocked so approve-hook tests assert on the call, not the HTTP side effect.
jest.mock("../lib/clipKit", () => ({
  notifyClipKit: jest.fn().mockResolvedValue(undefined),
}));

type JsonResponse = Record<string, any>;

const controller = new ClipsController();
const mockInvokeRenderClip = invokeRenderClip as jest.Mock;
const mockNotifyClipKit = notifyClipKit as jest.Mock;

// Built lazily (not at module-eval time) because GOOD_API_KEY is only
// generated in jest.setup.ts's beforeAll, which runs after this module
// is evaluated.
const authHeaders = (): Record<string, string> => ({
  Authorization: `Basic ${process.env.GOOD_API_KEY}`,
});

let uploadCounter = 0;

const makeUpload = async (overrides: Partial<Upload> = {}): Promise<Upload> => {
  uploadCounter += 1;
  const location = await Location.createFromAddress({
    latitude: 45.523064,
    longitude: -122.676483,
    fullAddress: `123 Main St, Portland, OR 97204 #${uploadCounter}`,
    address: "123 Main St",
    city: "Portland",
    state: "OR",
    zip: "97204",
  });

  const upload = new Upload();
  upload.ipAddress = "127.0.0.1";
  upload.filePath = `uploads/clip-test-${uploadCounter}.jpg`;
  upload.fileHash = `clip-test-hash-${uploadCounter}`;
  upload.location = location;
  upload.moderationStatus = "clean";
  upload.mediaStatus = "ready";
  Object.assign(upload, overrides);
  await upload.save();

  return upload;
};

const makeClip = async (
  upload: Upload,
  status: ClipStatus = "ready",
): Promise<Clip> => {
  const clip = new Clip();
  clip.upload = upload;
  clip.status = status;
  clip.kit = {
    caption: "Test caption",
    hashtags: ["#votingrights"],
    city: "Portland",
    state: "OR",
    reportedAt: "2024-11-05T14:30:00Z",
    shortUrlSlug: null,
  };
  await clip.save();

  return clip;
};

beforeEach(() => {
  mockInvokeRenderClip.mockClear();
  mockNotifyClipKit.mockClear();
  mockNotifyClipKit.mockResolvedValue(undefined);
});

describe("#create", () => {
  const validBody = () => ({
    uploadId: 1,
    city: "Portland",
    state: "OR",
    reportedAt: "2024-11-05T14:30:00Z",
  });

  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: validBody(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
    expect(mockInvokeRenderClip).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: { uploadId: 1 },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(response.statusCode).toEqual(400);
    expect(body.errors).toBeDefined();
  });

  it("returns 404 for a nonexistent upload", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      body: { ...validBody(), uploadId: 999999 },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.create(request, response, () => undefined);

    expect(response.statusCode).toEqual(404);
    expect(body).toEqual({ errors: ["Upload not found"] });
  });

  it("returns 400 when upload is not moderated as clean", async () => {
    const upload = await makeUpload({ moderationStatus: "pending" });
    const request = http_mocks.createRequest({
      method: "POST",
      body: { ...validBody(), uploadId: upload.id },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.create(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(400);
    expect(body.errors[0]).toMatch(/moderated as clean/i);
    expect(mockInvokeRenderClip).not.toHaveBeenCalled();
  });

  it("returns 400 when upload media is not ready", async () => {
    const upload = await makeUpload({ mediaStatus: "processing" });
    const request = http_mocks.createRequest({
      method: "POST",
      body: { ...validBody(), uploadId: upload.id },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.create(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(400);
    expect(body.errors[0]).toMatch(/media must be ready/i);
    expect(mockInvokeRenderClip).not.toHaveBeenCalled();
  });

  it("creates a queued clip from a clean+ready upload and fires the render", async () => {
    const upload = await makeUpload();
    const request = http_mocks.createRequest({
      method: "POST",
      body: { ...validBody(), uploadId: upload.id, captionText: "Long lines!" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.create(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(200);
    expect(body.status).toEqual("queued");
    expect(body.id).toBeTruthy();
    expect(body.kit.caption).toEqual("Long lines!");
    expect(body.kit.hashtags).toEqual([
      "#votingrights",
      "#ElectionDay",
      "#OR",
      "#Portland",
    ]);
    // CLIP-003: every clip gets a trackable short link at creation.
    expect(body.kit.shortUrlSlug).toMatch(/^[a-zA-Z0-9]{5}$/);

    const saved = await Clip.findOne({ where: { id: body.id } });
    expect(saved.status).toEqual("queued");
    expect(saved.kit.city).toEqual("Portland");
    expect(saved.kit.state).toEqual("OR");
    expect(saved.kit.reportedAt).toEqual("2024-11-05T14:30:00Z");
    expect(saved.kit.shortUrlSlug).toEqual(body.kit.shortUrlSlug);

    // The Link row is created with the clip's id as its campaign tag.
    const link = await Link.findOne({ where: { clipId: saved.id } });
    expect(link).toBeTruthy();
    expect(link!.campaignTag).toEqual(`clip-${saved.id}`);
    expect(link!.targetUrl).toEqual("https://www.polls.pizza/donate");
    expect(link!.slug).toEqual(saved.kit.shortUrlSlug);

    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(1);
    expect(mockInvokeRenderClip).toHaveBeenCalledWith(saved.id);
  });

  it("creates the Link with the DONATE_LANDING_URL override when configured", async () => {
    process.env.DONATE_LANDING_URL = "https://example.org/donate-now";
    try {
      const upload = await makeUpload();
      const request = http_mocks.createRequest({
        method: "POST",
        body: { ...validBody(), uploadId: upload.id },
        headers: authHeaders(),
      });
      const response = http_mocks.createResponse();

      const body = (await controller.create(
        request,
        response,
        () => undefined,
      )) as JsonResponse;

      const link = await Link.findOne({ where: { clipId: body.id } });
      expect(link!.targetUrl).toEqual("https://example.org/donate-now");
    } finally {
      delete process.env.DONATE_LANDING_URL;
    }
  });

  it("fails open when Link creation throws: clip still created + render fired, slug null", async () => {
    const createWithSlug = jest
      .spyOn(Link, "createWithSlug")
      .mockRejectedValue(new Error("links table on fire"));

    const upload = await makeUpload();
    const request = http_mocks.createRequest({
      method: "POST",
      body: { ...validBody(), uploadId: upload.id },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    try {
      const body = (await controller.create(
        request,
        response,
        () => undefined,
      )) as JsonResponse;

      expect(response.statusCode).toEqual(200);
      expect(body.status).toEqual("queued");
      expect(body.kit.shortUrlSlug).toBeNull();

      const saved = await Clip.findOne({ where: { id: body.id } });
      expect(saved.status).toEqual("queued");
      expect(saved.kit.shortUrlSlug).toBeNull();
      expect(mockInvokeRenderClip).toHaveBeenCalledTimes(1);
      expect(mockInvokeRenderClip).toHaveBeenCalledWith(saved.id);
    } finally {
      createWithSlug.mockRestore();
    }
  });
});

describe("#index", () => {
  it("returns 401 without auth", async () => {
    const request = http_mocks.createRequest({ method: "GET" });
    const response = http_mocks.createResponse();

    const body = await controller.index(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("returns all clips with auth", async () => {
    const upload = await makeUpload();
    await makeClip(upload, "queued");
    await makeClip(upload, "ready");

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

    expect(response.statusCode).toEqual(200);
    expect(body.count).toEqual(2);
    expect(body.results.length).toEqual(2);
    expect(body.results[0].status).toEqual("ready");
  });

  it("filters by status", async () => {
    const upload = await makeUpload();
    const queued = await makeClip(upload, "queued");
    await makeClip(upload, "ready");

    const request = http_mocks.createRequest({
      method: "GET",
      query: { status: "queued" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.index(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(body.count).toEqual(1);
    expect(body.results[0].id).toEqual(queued.id);
  });

  it("returns 400 for an invalid status filter", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      query: { status: "bogus" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.index(request, response, () => undefined);

    expect(response.statusCode).toEqual(400);
    expect(body.errors).toBeDefined();
  });
});

describe("#show", () => {
  it("returns 401 without auth", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "queued");
    const request = http_mocks.createRequest({
      method: "GET",
      params: { id: `${clip.id}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.show(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("returns full detail including operational fields", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "ready");
    clip.publishLog = [{ action: "rendered", at: "2024-11-05T15:00:00Z" }];
    await clip.save();

    const request = http_mocks.createRequest({
      method: "GET",
      params: { id: `${clip.id}` },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.show(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(200);
    expect(body.id).toEqual(clip.id);
    expect(body.uploadId).toEqual(upload.id);
    expect(body.kit).toEqual(clip.kit);
    expect(body.publishLog).toEqual(clip.publishLog);
    expect(body.failureReason).toBeNull();
    expect(body.approvedBy).toBeNull();
    expect(body.approvedAt).toBeNull();
  });

  it("returns 404 for a nonexistent clip", async () => {
    const request = http_mocks.createRequest({
      method: "GET",
      params: { id: "999999" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.show(request, response, () => undefined);

    expect(response.statusCode).toEqual(404);
    expect(body).toBeFalsy();
  });
});

describe("#approve", () => {
  it("returns 401 without auth", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "ready");
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.approve(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("transitions ready → approved and records approvedBy", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "ready");

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: { approvedBy: "admin@example.com" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.approve(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(200);
    expect(body.status).toEqual("approved");

    const saved = await Clip.findOne({ where: { id: clip.id } });
    expect(saved.status).toEqual("approved");
    expect(saved.approvedBy).toEqual("admin@example.com");
    expect(saved.approvedAt).toBeTruthy();
  });

  it("returns 400 when approving from a non-ready state", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "queued");

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.approve(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(400);
    expect(body.errors[0]).toMatch(/cannot approve clip in queued state/i);

    const saved = await Clip.findOne({ where: { id: clip.id } });
    expect(saved.status).toEqual("queued");
  });

  it("returns 404 for a nonexistent clip", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: "999999" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.approve(request, response, () => undefined);

    expect(response.statusCode).toEqual(404);
    expect(body).toBeFalsy();
    expect(mockNotifyClipKit).not.toHaveBeenCalled();
  });

  it("fires the Slack kit notifier after saving the approved clip", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "ready");

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.approve(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(200);
    expect(body.status).toEqual("approved");
    expect(mockNotifyClipKit).toHaveBeenCalledTimes(1);
    expect(mockNotifyClipKit).toHaveBeenCalledWith(
      expect.objectContaining({ id: clip.id, status: "approved" }),
    );
  });

  it("does not fire the notifier when the transition is rejected", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "queued");

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    await controller.approve(request, response, () => undefined);

    expect(response.statusCode).toEqual(400);
    expect(mockNotifyClipKit).not.toHaveBeenCalled();
  });

  it("still approves successfully when the notifier crashes", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "ready");
    mockNotifyClipKit.mockRejectedValue(new Error("Slack is down"));

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.approve(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(200);
    expect(body.status).toEqual("approved");

    const saved = await Clip.findOne({ where: { id: clip.id } });
    expect(saved.status).toEqual("approved");

    // Wait for microtasks so the fire-and-forget .catch handler runs
    // without an unhandled rejection leaking into other tests.
    await new Promise(setImmediate);
  });
});

describe("#publish", () => {
  it("returns 401 without auth", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "approved");
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: { platform: "tiktok" },
    });
    const response = http_mocks.createResponse();

    const body = await controller.publish(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("returns 404 for a nonexistent clip", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: "999999" },
      body: { platform: "tiktok" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.publish(request, response, () => undefined);

    expect(response.statusCode).toEqual(404);
    expect(body).toBeFalsy();
  });

  it("returns 400 for a queued clip (invalid transition)", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "queued");
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: { platform: "tiktok" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.publish(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(400);
    expect(body.errors[0]).toMatch(/cannot publish clip in queued state/i);

    const saved = await Clip.findOne({ where: { id: clip.id } });
    expect(saved.status).toEqual("queued");
    expect(saved.publishLog).toBeNull();
  });

  it("returns 400 when platform is missing", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "approved");
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: {},
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.publish(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(400);
    expect(body.errors[0]).toMatch(/platform is required/i);
  });

  it("appends a log entry and flips approved → published", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "approved");
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: { platform: "tiktok" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const before = Date.now();
    const body = (await controller.publish(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(200);
    expect(body.status).toEqual("published");

    const saved = await Clip.findOne({ where: { id: clip.id } });
    expect(saved.status).toEqual("published");
    expect(saved.publishLog).toHaveLength(1);
    const [entry] = saved.publishLog as Array<Record<string, unknown>>;
    expect(entry.platform).toEqual("tiktok");
    expect(typeof entry.postedAt).toEqual("string");
    const postedAtMs = new Date(entry.postedAt as string).getTime();
    expect(postedAtMs).toBeGreaterThanOrEqual(before);
    expect(entry.note).toBeUndefined();
  });

  it("records the optional note with the log entry", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "approved");
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: { platform: "reels", note: "Posted by @volunteer" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    await controller.publish(request, response, () => undefined);

    const saved = await Clip.findOne({ where: { id: clip.id } });
    expect(saved.publishLog).toEqual([
      {
        platform: "reels",
        postedAt: expect.any(String),
        note: "Posted by @volunteer",
      },
    ]);
  });

  it("appends a second platform to an already-published clip without changing status", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "published");
    clip.publishLog = [
      { platform: "tiktok", postedAt: "2024-11-05T18:00:00.000Z" },
    ];
    await clip.save();

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: { platform: "shorts" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.publish(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(200);
    expect(body.status).toEqual("published");

    const saved = await Clip.findOne({ where: { id: clip.id } });
    expect(saved.status).toEqual("published");
    expect(saved.publishLog).toHaveLength(2);
    expect(saved.publishLog![0].platform).toEqual("tiktok");
    expect(saved.publishLog![1].platform).toEqual("shorts");
  });
});

describe("#reject", () => {
  it("returns 401 without auth", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "ready");
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: { reason: "Blurry" },
    });
    const response = http_mocks.createResponse();

    const body = await controller.reject(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("returns 400 when reason is missing", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "ready");
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: {},
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.reject(request, response, () => undefined);

    expect(response.statusCode).toEqual(400);
    expect(body.errors[0]).toMatch(/reason is required/i);
  });

  it("transitions ready → rejected with failureReason", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "ready");

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: { reason: "Blurry footage" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.reject(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(200);
    expect(body.status).toEqual("rejected");

    const saved = await Clip.findOne({ where: { id: clip.id } });
    expect(saved.status).toEqual("rejected");
    expect(saved.failureReason).toEqual("Blurry footage");
  });

  it("transitions rendering → rejected", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "rendering");

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: { reason: "Render stuck" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.reject(request, response, () => undefined);

    expect(response.statusCode).toEqual(200);
    expect(body.status).toEqual("rejected");
  });

  it("returns 400 from a terminal state (published)", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "published");

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      body: { reason: "Too late" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.reject(request, response, () => undefined);

    expect(response.statusCode).toEqual(400);
    expect(body.errors[0]).toMatch(/cannot reject clip in published state/i);
  });
});

describe("#requeue", () => {
  it("returns 401 without auth", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "rejected");
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
    });
    const response = http_mocks.createResponse();

    const body = await controller.requeue(request, response, () => undefined);

    expect(response.statusCode).toEqual(401);
    expect(body).toEqual({ errors: ["Not authorized"] });
  });

  it("transitions rejected → queued, clears failureReason, and re-fires the render", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "rejected");
    clip.failureReason = "Render failed";
    clip.outputPaths = { video: "clips/1/clip.mp4" };
    await clip.save();

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.requeue(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(200);
    expect(body.status).toEqual("queued");

    const saved = await Clip.findOne({ where: { id: clip.id } });
    expect(saved.status).toEqual("queued");
    expect(saved.failureReason).toBeNull();
    expect(saved.outputPaths).toBeNull();

    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(1);
    expect(mockInvokeRenderClip).toHaveBeenCalledWith(clip.id);
  });

  it("returns 400 for a queued clip (cannot requeue)", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "queued");

    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: `${clip.id}` },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = (await controller.requeue(
      request,
      response,
      () => undefined,
    )) as JsonResponse;

    expect(response.statusCode).toEqual(400);
    expect(body.errors[0]).toMatch(/cannot requeue clip in queued state/i);
    expect(mockInvokeRenderClip).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent clip", async () => {
    const request = http_mocks.createRequest({
      method: "POST",
      params: { id: "999999" },
      headers: authHeaders(),
    });
    const response = http_mocks.createResponse();

    const body = await controller.requeue(request, response, () => undefined);

    expect(response.statusCode).toEqual(404);
    expect(body).toBeFalsy();
    expect(mockInvokeRenderClip).not.toHaveBeenCalled();
  });
});
