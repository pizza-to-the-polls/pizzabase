/**
 * Handler tests for the renderClip lambda.
 *
 * S3 is mocked at the SDK boundary and the ffmpeg execution layer
 * (src/lib/ffmpeg-exec.ts) is mocked so no ffmpeg binary is needed in CI.
 * The Clip/Upload entities run against the real test database so status
 * transitions and the outputPaths JSONB contract are verified end-to-end.
 * Fake ffmpeg outputs are pre-seeded in the deterministic work directory
 * (exported renderWorkDir) so the handler's upload step has files to read.
 */
import * as fs from "fs";
import * as path from "path";

import { Clip, ClipStatus } from "../../entity/Clip";
import { Location } from "../../entity/Location";
import { Upload } from "../../entity/Upload";
import { runFfmpeg } from "../../lib/ffmpeg-exec";
import * as QRCode from "qrcode";

const mockS3Send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  const original = jest.requireActual("@aws-sdk/client-s3");
  return {
    ...original,
    S3Client: jest.fn(() => ({ send: mockS3Send })),
    GetObjectCommand: jest.fn((input: Record<string, unknown>) => ({
      input,
      commandName: "GetObject",
    })),
    PutObjectCommand: jest.fn((input: Record<string, unknown>) => ({
      input,
      commandName: "PutObject",
    })),
  };
});

jest.mock("../../lib/ffmpeg-exec", () => ({
  runFfmpeg: jest.fn(),
}));

// Pure-JS QR generator is mocked at the module boundary — no PNG is actually
// written; the handler contract under test is "QR attempted with the right
// payload, path handed to the template".
jest.mock("qrcode", () => ({
  toFile: jest.fn().mockResolvedValue(undefined),
}));

const mockRunFfmpeg = runFfmpeg as jest.Mock;
const mockQrToFile = QRCode.toFile as jest.Mock;

const BUCKET = "reports.polls.pizza";

let handler: (event: { clipId?: number }) => Promise<void>;
let renderWorkDir: (clipId: number) => string;
let s3KeyFromStoredUrl: (url: string, bucket: string) => string | null;

beforeAll(async () => {
  // Imported after the mocks above so the module-level S3Client picks up
  // the mocked constructor.
  const renderModule = await import("../renderClip");
  handler = renderModule.handler;
  renderWorkDir = renderModule.renderWorkDir;
  s3KeyFromStoredUrl = renderModule.s3KeyFromStoredUrl;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function box(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}

function mvhdBox(timescale: number, duration: number): Buffer {
  const body = Buffer.alloc(100);
  body.writeUInt32BE(timescale, 12);
  body.writeUInt32BE(duration, 16);
  return box("mvhd", body);
}

/** Minimal MP4 with a parseable moov/mvhd duration (seconds × 600). */
function mp4Buffer(durationSeconds: number): Buffer {
  return Buffer.concat([
    box("ftyp", Buffer.alloc(8)),
    box("moov", mvhdBox(600, durationSeconds * 600)),
  ]);
}

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
  upload.filePath = `uploads/render-test-${uploadCounter}.mp4`;
  upload.fileHash = `render-test-hash-${uploadCounter}`;
  upload.location = location;
  upload.moderationStatus = "clean";
  upload.mediaStatus = "ready";
  upload.processedFilePath = {
    mp4: `https://media.polls.pizza/uploads/render-${uploadCounter}-transcoded.mp4`,
    poster: `uploads/render-${uploadCounter}-poster.0000001.jpg`,
  };
  Object.assign(upload, overrides);
  await upload.save();
  return upload;
};

const makeClip = async (
  upload: Upload,
  status: ClipStatus = "queued",
): Promise<Clip> => {
  const clip = new Clip();
  clip.upload = upload;
  clip.status = status;
  clip.kit = {
    caption: "The line is around the block!",
    hashtags: ["#votingrights", "#ElectionDay", "#OR", "#Portland"],
    city: "Portland",
    state: "OR",
    reportedAt: "2024-11-05T14:30:00Z",
    shortUrlSlug: null,
  };
  await clip.save();
  return clip;
};

/** Pre-seed fake ffmpeg outputs so the handler's upload step can read them. */
function seedOutputs(clipId: number): void {
  const dir = renderWorkDir(clipId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "clip.mp4"), Buffer.from("fake-video-bytes"));
  fs.writeFileSync(path.join(dir, "clip.srt"), Buffer.from("fake-srt-bytes"));
  fs.writeFileSync(
    path.join(dir, "poster.jpg"),
    Buffer.from("fake-jpeg-bytes"),
  );
}

function s3ServesSource(buffer: Buffer): void {
  mockS3Send.mockImplementation(async (cmd: any) => {
    if (cmd.commandName === "GetObject") {
      return { Body: { transformToByteArray: async () => buffer } };
    }
    return {}; // PutObject
  });
}

function putCalls(): any[] {
  return mockS3Send.mock.calls
    .filter(([cmd]: any[]) => cmd.commandName === "PutObject")
    .map(([cmd]: any[]) => cmd.input);
}

const reloadClip = async (id: number): Promise<Clip> =>
  (await Clip.findOne({ where: { id } }))!;

beforeEach(() => {
  mockRunFfmpeg.mockResolvedValue(undefined);
  mockQrToFile.mockResolvedValue(undefined);
  delete process.env.RENDER_DAILY_BUDGET;
  delete process.env.RENDER_FONT_FILE;
  delete process.env.SHORT_URL_BASE;
});

afterEach(() => {
  delete process.env.RENDER_DAILY_BUDGET;
  delete process.env.RENDER_FONT_FILE;
  delete process.env.SHORT_URL_BASE;
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("happy path", () => {
  it("renders a queued clip to ready with the 4-asset output bundle", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    seedOutputs(clip.id);
    s3ServesSource(mp4Buffer(30));

    await handler({ clipId: clip.id });

    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("ready");
    expect(saved.failureReason).toBeNull();
    expect(saved.outputPaths).toEqual({
      video: `clips/${clip.id}/clip.mp4`,
      captions: `clips/${clip.id}/clip.srt`,
      poster: `clips/${clip.id}/poster.jpg`,
      kit: `clips/${clip.id}/kit.json`,
    });

    // Both ffmpeg invocations ran: poster extraction + main render.
    expect(mockRunFfmpeg).toHaveBeenCalledTimes(2);
    const posterArgs = mockRunFfmpeg.mock.calls[0][1];
    expect(posterArgs).toEqual(expect.arrayContaining(["-frames:v", "1"]));
    expect(posterArgs[posterArgs.length - 1]).toBe(
      `${renderWorkDir(clip.id)}/poster.jpg`,
    );
    const renderArgs = mockRunFfmpeg.mock.calls[1][1];
    expect(renderArgs[renderArgs.length - 1]).toBe(
      `${renderWorkDir(clip.id)}/clip.mp4`,
    );
  });

  it("downloads the source MP4 from the processed bucket by URL key", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    seedOutputs(clip.id);
    s3ServesSource(mp4Buffer(30));

    await handler({ clipId: clip.id });

    const get = mockS3Send.mock.calls.find(
      ([cmd]: any[]) => cmd.commandName === "GetObject",
    );
    const mp4Url = upload.processedFilePath!.mp4!;
    expect(get![0].input).toEqual({
      Bucket: BUCKET,
      Key: `uploads/${mp4Url.split("/").pop()}`,
    });
  });

  it("uploads the bundle with correct keys and content types", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    seedOutputs(clip.id);
    s3ServesSource(mp4Buffer(30));

    await handler({ clipId: clip.id });

    const puts = putCalls();
    expect(puts).toHaveLength(4);
    expect(puts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Bucket: BUCKET,
          Key: `clips/${clip.id}/clip.mp4`,
          ContentType: "video/mp4",
        }),
        expect.objectContaining({
          Bucket: BUCKET,
          Key: `clips/${clip.id}/clip.srt`,
          ContentType: "application/x-subrip",
        }),
        expect.objectContaining({
          Bucket: BUCKET,
          Key: `clips/${clip.id}/poster.jpg`,
          ContentType: "image/jpeg",
        }),
        expect.objectContaining({
          Bucket: BUCKET,
          Key: `clips/${clip.id}/kit.json`,
          ContentType: "application/json",
        }),
      ]),
    );

    const videoPut = puts.find((p) => p.Key.endsWith("clip.mp4"));
    expect((videoPut.Body as Buffer).toString()).toBe("fake-video-bytes");

    const kitPut = puts.find((p) => p.Key.endsWith("kit.json"));
    const kit = JSON.parse((kitPut.Body as Buffer).toString());
    expect(kit.caption).toBe("The line is around the block! 🍕🗳");
    expect(kit.city).toBe("Portland");
    expect(kit.state).toBe("OR");
    expect(kit.reportedAt).toBe("2024-11-05T14:30:00Z");
    expect(kit.shortUrlSlug).toBeNull();
    expect(kit.platforms).toEqual(["tiktok", "reels", "shorts"]);
    expect(kit.hashtags).toEqual([
      "#votingrights",
      "#ElectionDay",
      "#OR",
      "#Portland",
    ]);
    expect(kit.assets).toEqual({
      video: `clips/${clip.id}/clip.mp4`,
      captions: `clips/${clip.id}/clip.srt`,
      poster: `clips/${clip.id}/poster.jpg`,
    });
  });

  it("passes the render template the clip's kit and a 90s cap", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    seedOutputs(clip.id);
    s3ServesSource(mp4Buffer(30));

    process.env.RENDER_FONT_FILE = "/opt/fonts/Test.ttf";
    await handler({ clipId: clip.id });

    const renderCall = mockRunFfmpeg.mock.calls[1];
    const graph = renderCall[1][renderCall[1].indexOf("-filter_complex") + 1];
    expect(graph).toContain("fontfile=/opt/fonts/Test.ttf");
    expect(graph).toContain("lowerthird-city.txt");
  });
});

// ---------------------------------------------------------------------------
// End-card QR / short-link wiring
// ---------------------------------------------------------------------------

describe("end-card QR wiring", () => {
  it("generates the QR from the short URL and passes the path to the template", async () => {
    process.env.SHORT_URL_BASE = "https://link.polls.pizza/l";
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    clip.kit = { ...clip.kit, shortUrlSlug: "abc12" };
    await clip.save();
    seedOutputs(clip.id);
    s3ServesSource(mp4Buffer(30));

    await handler({ clipId: clip.id });

    expect(mockQrToFile).toHaveBeenCalledTimes(1);
    const [qrPath, qrUrl] = mockQrToFile.mock.calls[0];
    expect(qrPath).toBe(`${renderWorkDir(clip.id)}/endcard-qr.png`);
    expect(qrUrl).toBe("https://link.polls.pizza/l/abc12");
    expect(mockQrToFile).toHaveBeenCalledWith(
      `${renderWorkDir(clip.id)}/endcard-qr.png`,
      "https://link.polls.pizza/l/abc12",
      expect.objectContaining({ type: "png", width: 200 }),
    );
    // The generated path reaches the ffmpeg invocation as a third input.
    const renderArgs = mockRunFfmpeg.mock.calls[1][1];
    expect(renderArgs).toContain(`${renderWorkDir(clip.id)}/endcard-qr.png`);
    const graph = renderArgs[renderArgs.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[card][qr]overlay=(W-w)/2:980[cardwqr]");
    // The kit.json asset bundle is unchanged by the QR (still 4 uploads).
    expect(putCalls()).toHaveLength(4);
  });

  it("degrades to a text-only end-card when QR generation fails", async () => {
    mockQrToFile.mockRejectedValue(new Error("canvas exploded"));
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    clip.kit = { ...clip.kit, shortUrlSlug: "abc12" };
    await clip.save();
    seedOutputs(clip.id);
    s3ServesSource(mp4Buffer(30));

    await handler({ clipId: clip.id });

    // Fail-open: the render completes ready, with a text-only end-card.
    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("ready");
    const renderArgs = mockRunFfmpeg.mock.calls[1][1];
    expect(renderArgs).not.toContain(
      `${renderWorkDir(clip.id)}/endcard-qr.png`,
    );
    const graph = renderArgs[renderArgs.indexOf("-filter_complex") + 1];
    expect(graph).toContain("endcard-url.txt");
    expect(graph).toContain("y=990");
    expect(graph).not.toContain("[qr]");
    expect(putCalls()).toHaveLength(4);
  });

  it("does not attempt QR generation when the kit has no slug", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload); // shortUrlSlug: null
    seedOutputs(clip.id);
    s3ServesSource(mp4Buffer(30));

    await handler({ clipId: clip.id });

    expect(mockQrToFile).not.toHaveBeenCalled();
    const renderArgs = mockRunFfmpeg.mock.calls[1][1];
    expect(renderArgs).not.toContain("endcard-qr.png");
  });

  it("falls back to the default short URL base when SHORT_URL_BASE is unset", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    clip.kit = { ...clip.kit, shortUrlSlug: "zz9zz" };
    await clip.save();
    seedOutputs(clip.id);
    s3ServesSource(mp4Buffer(30));

    await handler({ clipId: clip.id });

    expect(mockQrToFile).toHaveBeenCalledWith(
      `${renderWorkDir(clip.id)}/endcard-qr.png`,
      "https://polls.pizza/l/zz9zz",
      expect.objectContaining({ type: "png", width: 200 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

describe("guardrails", () => {
  it("leaves the clip queued when the daily render budget is exhausted", async () => {
    process.env.RENDER_DAILY_BUDGET = "0";
    const upload = await makeUpload();
    const clip = await makeClip(upload);

    await handler({ clipId: clip.id });

    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("queued");
    expect(saved.outputPaths).toBeNull();
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockRunFfmpeg).not.toHaveBeenCalled();
  });

  it("rejects sources longer than 90s with the limit in the reason", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    s3ServesSource(mp4Buffer(200));

    await handler({ clipId: clip.id });

    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("rejected");
    expect(saved.failureReason).toMatch(/exceeds the 90s clip limit/);
    expect(mockRunFfmpeg).not.toHaveBeenCalled();
    expect(putCalls()).toHaveLength(0);
  });

  it("rejects sources with an undetectable duration", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    s3ServesSource(Buffer.from("definitely-not-an-mp4"));

    await handler({ clipId: clip.id });

    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("rejected");
    expect(saved.failureReason).toMatch(/duration could not be determined/i);
    expect(mockRunFfmpeg).not.toHaveBeenCalled();
  });

  it("is a no-op for a clip that is no longer queued (double invoke)", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "rendering");

    await handler({ clipId: clip.id });

    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("rendering");
    expect(saved.outputPaths).toBeNull();
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockRunFfmpeg).not.toHaveBeenCalled();
  });

  it("skips non-queued terminal states the same way (e.g. approved)", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload, "approved");

    await handler({ clipId: clip.id });

    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("approved");
    expect(mockRunFfmpeg).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

describe("failure paths", () => {
  it("rejects with the ffmpeg error when rendering fails", async () => {
    mockRunFfmpeg.mockRejectedValue(new Error("ffmpeg exploded"));
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    seedOutputs(clip.id);
    s3ServesSource(mp4Buffer(30));

    await handler({ clipId: clip.id });

    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("rejected");
    expect(saved.failureReason).toMatch(/ffmpeg exploded/);
    expect(putCalls()).toHaveLength(0);
  });

  it("rejects when the upload has no processed MP4", async () => {
    const upload = await makeUpload({ processedFilePath: null });
    const clip = await makeClip(upload);

    await handler({ clipId: clip.id });

    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("rejected");
    expect(saved.failureReason).toMatch(/no processed MP4/i);
    expect(mockRunFfmpeg).not.toHaveBeenCalled();
  });

  it("rejects when the clip has no render kit", async () => {
    const upload = await makeUpload();
    const clip = await makeClip(upload);
    clip.kit = null;
    await clip.save();

    await handler({ clipId: clip.id });

    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("rejected");
    expect(saved.failureReason).toMatch(/no render kit/i);
  });

  it("rejects when the source MP4 URL cannot be mapped to a key", async () => {
    const upload = await makeUpload({
      processedFilePath: { mp4: "not-a-url" },
    });
    const clip = await makeClip(upload);
    s3ServesSource(mp4Buffer(30));

    await handler({ clipId: clip.id });

    const saved = await reloadClip(clip.id);
    expect(saved.status).toBe("rejected");
    expect(saved.failureReason).toMatch(/Could not determine S3 key/);
  });

  it("quietly ignores an unknown clipId", async () => {
    await expect(handler({ clipId: 999999 })).resolves.toBeUndefined();
    expect(mockRunFfmpeg).not.toHaveBeenCalled();
  });

  it("quietly ignores a missing clipId", async () => {
    await expect(handler({})).resolves.toBeUndefined();
    await expect(handler({ clipId: 0 })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("s3KeyFromStoredUrl", () => {
  it("extracts the key from CDN URLs", () => {
    expect(
      s3KeyFromStoredUrl("https://media.polls.pizza/uploads/a.mp4", BUCKET),
    ).toBe("uploads/a.mp4");
  });

  it("extracts the key from path-style S3 URLs", () => {
    expect(
      s3KeyFromStoredUrl(
        `https://s3.us-west-2.amazonaws.com/${BUCKET}/uploads/b.mp4`,
        BUCKET,
      ),
    ).toBe("uploads/b.mp4");
  });

  it("extracts the key from s3:// URIs", () => {
    expect(s3KeyFromStoredUrl(`s3://${BUCKET}/uploads/c.mp4`, BUCKET)).toBe(
      "uploads/c.mp4",
    );
  });

  it("returns null for unparseable input", () => {
    expect(s3KeyFromStoredUrl("not-a-url", BUCKET)).toBeNull();
  });
});
