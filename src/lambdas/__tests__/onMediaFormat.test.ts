/**
 * Unit tests for the on-media-format lambda (poster frame extraction).
 *
 * The S3 and MediaConvert clients are mocked at the SDK boundary; the Upload
 * entity runs against the real test database so we verify the JSONB
 * processed_file_path contract end-to-end. sharp is mocked (it is provided
 * via a Lambda layer and is not a project dependency) — we only exercise the
 * pipeline wiring, not image encoding itself.
 */
import { Upload } from "../../entity/Upload";
import { Location } from "../../entity/Location";

const mockS3Send = jest.fn();
const mockMediaConvertSend = jest.fn();

// Mutated per-test to drive the mocked sharp metadata
const mockSharpMetadata = { width: 4000, height: 3000, format: "jpeg" };

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

jest.mock("@aws-sdk/client-mediaconvert", () => {
  const original = jest.requireActual("@aws-sdk/client-mediaconvert");
  return {
    ...original,
    MediaConvertClient: jest.fn(() => ({ send: mockMediaConvertSend })),
    DescribeEndpointsCommand: jest.fn(() => ({
      input: {},
      commandName: "DescribeEndpoints",
    })),
    CreateJobCommand: jest.fn((input: Record<string, unknown>) => ({
      input,
      commandName: "CreateJob",
    })),
  };
});

jest.mock(
  "sharp",
  () => {
    const makeInstance = () => {
      const inst: Record<string, any> = {};
      const chain = () => inst;
      inst.rotate = chain;
      inst.resize = chain;
      inst.clone = chain;
      inst.webp = chain;
      inst.jpeg = chain;
      inst.gif = chain;
      inst.metadata = () => Promise.resolve(mockSharpMetadata);
      inst.toBuffer = () => Promise.resolve(Buffer.from("sharp-encoded"));
      return inst;
    };
    return jest.fn(() => makeInstance());
  },
  { virtual: true },
);

const BUCKET = "reports.polls.pizza";
const RAW_BUCKET = "raw.polls.pizza";

let handler: (event: unknown) => Promise<void>;

beforeAll(async () => {
  // Imported after the mocks above so the module-level S3Client picks up the
  // mocked constructor.
  ({ handler } = await import("../onMediaFormat"));
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

const IDENTITY_MATRIX = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];

function tkhdBox(widthPx: number, heightPx: number): Buffer {
  const body = Buffer.alloc(84);
  IDENTITY_MATRIX.forEach((v, i) => body.writeInt32BE(v, 40 + i * 4));
  body.writeUInt32BE(widthPx * 65536, 76);
  body.writeUInt32BE(heightPx * 65536, 80);
  return box("tkhd", body);
}

function mvhdBox(timescale: number, duration: number): Buffer {
  const body = Buffer.alloc(100);
  body.writeUInt32BE(timescale, 12);
  body.writeUInt32BE(duration, 16);
  return box("mvhd", body);
}

/**
 * Minimal MP4: ftyp + moov(mvhd + trak(tkhd)). Pass no duration to get a
 * buffer with no moov (duration and dimensions undetectable).
 */
function mp4Buffer(
  opts: {
    timescale?: number;
    duration?: number;
    width?: number;
    height?: number;
  } = {},
): Buffer {
  if (opts.duration === undefined) {
    return Buffer.concat([box("ftyp", Buffer.alloc(8)), Buffer.alloc(32)]);
  }
  return Buffer.concat([
    box("ftyp", Buffer.alloc(8)),
    box(
      "moov",
      Buffer.concat([
        mvhdBox(opts.timescale ?? 600, opts.duration),
        box("trak", tkhdBox(opts.width ?? 1920, opts.height ?? 1080)),
      ]),
    ),
  ]);
}

async function createUpload(
  rawKey: string,
  overrides: Partial<Upload> = {},
): Promise<Upload> {
  const location = await Location.createFromAddress({
    latitude: 41.79907,
    longitude: -87.58413,
    fullAddress: "900 Test Blvd Chicago IL 60615",
    address: "900 Test Blvd",
    city: "Chicago",
    state: "IL",
    zip: "60615",
  });
  const upload = new Upload();
  upload.location = location;
  upload.ipAddress = "127.0.0.1";
  upload.filePath = rawKey;
  upload.fileHash = `hash-${rawKey}`;
  upload.rawFilePath = rawKey;
  Object.assign(upload, overrides);
  await upload.save();
  return upload;
}

const s3Event = (key: string) => ({
  Records: [
    { s3: { bucket: { name: RAW_BUCKET }, object: { key, size: 1024 } } },
  ],
});

/** Serve the given bytes for GetObject; accept any PutObject. */
function s3ServesRaw(raw: Buffer) {
  mockS3Send.mockImplementation(async (cmd: any) => {
    if (cmd.commandName === "GetObject") {
      return { Body: { transformToByteArray: async () => raw } };
    }
    return {}; // PutObject
  });
}

function mediaConvertServesJob() {
  mockMediaConvertSend.mockImplementation(async (cmd: any) => {
    if (cmd.commandName === "DescribeEndpoints") {
      return {
        Endpoints: [{ Url: "https://mediaconvert.us-west-2.amazonaws.com" }],
      };
    }
    if (cmd.commandName === "CreateJob") {
      return { Job: { Id: "test-job-id" } };
    }
    throw new Error(`Unexpected MediaConvert command: ${cmd.commandName}`);
  });
}

function createdJobInput(): any {
  const createCall = mockMediaConvertSend.mock.calls.find(
    ([cmd]: any[]) => cmd.commandName === "CreateJob",
  );
  expect(createCall).toBeDefined();
  return createCall![0].input;
}

beforeEach(() => {
  mockS3Send.mockReset();
  mockMediaConvertSend.mockReset();
  mockSharpMetadata.width = 4000;
  mockSharpMetadata.height = 3000;
  mockSharpMetadata.format = "jpeg";
});

// ---------------------------------------------------------------------------
// Image path
// ---------------------------------------------------------------------------

describe("image uploads", () => {
  it("writes webp + jpeg and sets poster to the resized jpeg key", async () => {
    const upload = await createUpload("uploads/photo.jpg");
    s3ServesRaw(Buffer.from("raw-image-bytes"));

    await handler(s3Event("uploads/photo.jpg"));

    const updated = (await Upload.findOne({
      where: { id: upload.id },
    }))!;
    expect(updated.mediaStatus).toBe("ready");
    expect(updated.exifScrubbed).toBe(true);

    const processed = updated.processedFilePath!;
    expect(processed.webp).toBe(
      `https://s3.us-west-2.amazonaws.com/${BUCKET}/uploads/${upload.id}.webp`,
    );
    expect(processed.jpeg).toBe(
      `https://s3.us-west-2.amazonaws.com/${BUCKET}/uploads/${upload.id}.jpeg`,
    );
    // Poster is the bare S3 key of the resized JPEG — consumers never branch
    // on media type.
    expect(processed.poster).toBe(`uploads/${upload.id}.jpeg`);
    expect(Object.keys(processed).sort()).toEqual(["jpeg", "poster", "webp"]);

    const puts = mockS3Send.mock.calls.filter(
      ([cmd]: any[]) => cmd.commandName === "PutObject",
    );
    expect(puts).toHaveLength(2);
    const putInputs = puts.map(([cmd]: any[]) => cmd.input);
    expect(putInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Bucket: BUCKET,
          Key: `uploads/${upload.id}.webp`,
          ContentType: "image/webp",
          ACL: "public-read",
        }),
        expect.objectContaining({
          Bucket: BUCKET,
          Key: `uploads/${upload.id}.jpeg`,
          ContentType: "image/jpeg",
          ACL: "public-read",
        }),
      ]),
    );
  });

  it("uses the gif output as its own poster for animated GIFs", async () => {
    mockSharpMetadata.format = "gif";
    mockSharpMetadata.width = 800;
    mockSharpMetadata.height = 600;

    const upload = await createUpload("uploads/animation.gif");
    s3ServesRaw(Buffer.from("gif-bytes"));

    await handler(s3Event("uploads/animation.gif"));

    const updated = (await Upload.findOne({
      where: { id: upload.id },
    }))!;
    expect(updated.mediaStatus).toBe("ready");
    const processed = updated.processedFilePath!;
    expect(processed.gif).toBe(
      `https://s3.us-west-2.amazonaws.com/${BUCKET}/uploads/${upload.id}.gif`,
    );
    expect(processed.poster).toBe(`uploads/${upload.id}.gif`);
    // Animated GIFs do not get the webp/jpeg pair
    expect(processed.webp).toBeUndefined();
    expect(processed.jpeg).toBeUndefined();
  });

  it("skips already-processed uploads (duplicate S3 event guard)", async () => {
    await createUpload("uploads/already-done.jpg", {
      mediaStatus: "ready",
      processedFilePath: { webp: "https://example.com/old.webp" },
    });

    await handler(s3Event("uploads/already-done.jpg"));

    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("marks uploads with unknown extensions as failed", async () => {
    const upload = await createUpload("uploads/document.pdf");

    await handler(s3Event("uploads/document.pdf"));

    const updated = (await Upload.findOne({
      where: { id: upload.id },
    }))!;
    expect(updated.mediaStatus).toBe("failed");
    expect(mockMediaConvertSend).not.toHaveBeenCalled();
  });

  it("ignores objects with no matching upload record", async () => {
    await handler(s3Event("uploads/ghost.jpg"));
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Video path (MediaConvert + poster frame capture)
// ---------------------------------------------------------------------------

describe("video uploads", () => {
  it("adds a poster frame-capture output group to the MediaConvert job", async () => {
    const upload = await createUpload("uploads/clip.mp4");
    // 30s video (18000 ticks @ 600/s), 1920x1080 display dimensions
    s3ServesRaw(mp4Buffer({ duration: 18000, timescale: 600 }));
    mediaConvertServesJob();

    await handler(s3Event("uploads/clip.mp4"));

    const job = createdJobInput();
    const groups = job.Settings.OutputGroups;
    expect(groups).toHaveLength(2);

    // Existing transcode group unchanged (no regression)
    expect(groups[0].OutputGroupSettings.Type).toBe("FILE_GROUP_SETTINGS");
    expect(groups[0].Outputs[0].NameModifier).toBe("_transcoded");
    expect(groups[0].Outputs[0].ContainerSettings.Container).toBe("MP4");
    expect(groups[0].Outputs[0].VideoDescription.Height).toBe(1080);
    expect(groups[0].Outputs[0].VideoDescription.Width).toBeUndefined();

    // Poster frame-capture group
    const posterGroup = groups[1];
    expect(posterGroup.OutputGroupSettings.Type).toBe("FILE_GROUP_SETTINGS");
    expect(posterGroup.OutputGroupSettings.FileGroupSettings.Destination).toBe(
      groups[0].OutputGroupSettings.FileGroupSettings.Destination,
    );
    const posterOutput = posterGroup.Outputs[0];
    expect(posterOutput.ContainerSettings.Container).toBe("RAW");
    expect(posterOutput.Extension).toBe("jpg");
    expect(posterOutput.NameModifier).toBe("_poster");
    expect(posterOutput.VideoDescription.CodecSettings.Codec).toBe(
      "FRAME_CAPTURE",
    );
    // 10% of 30s = 3s → one frame every 3s; 0-based capture #1 is the poster
    expect(
      posterOutput.VideoDescription.CodecSettings.FrameCaptureSettings,
    ).toEqual({
      FramerateNumerator: 1,
      FramerateDenominator: 3,
      MaxCaptures: 2,
      Quality: 80,
    });
    // 1080px max dimension, aspect preserved: 1920x1080 → 1080x608
    expect(posterOutput.VideoDescription.Width).toBe(1080);
    expect(posterOutput.VideoDescription.Height).toBe(608);

    expect(job.UserMetadata).toEqual({
      uploadId: String(upload.id),
      sourceKey: "uploads/clip.mp4",
      posterTargetIndex: "1",
    });

    const updated = (await Upload.findOne({
      where: { id: upload.id },
    }))!;
    expect(updated.processedFilePath).toEqual({ jobId: "test-job-id" });
    expect(updated.mediaStatus).toBe("processing");
    expect(updated.exifScrubbed).toBe(true);
  });

  it("targets the 10% frame for longer videos", async () => {
    await createUpload("uploads/long.mp4");
    // 300s video: interval 10s, 0-based capture #3 (t=30s) is the poster
    s3ServesRaw(mp4Buffer({ duration: 180000, timescale: 600 }));
    mediaConvertServesJob();

    await handler(s3Event("uploads/long.mp4"));

    const posterOutput = createdJobInput().Settings.OutputGroups[1].Outputs[0];
    expect(
      posterOutput.VideoDescription.CodecSettings.FrameCaptureSettings,
    ).toEqual({
      FramerateNumerator: 1,
      FramerateDenominator: 10,
      MaxCaptures: 4,
      Quality: 80,
    });
    expect(createdJobInput().UserMetadata.posterTargetIndex).toBe("3");
  });

  it("falls back to a 1s capture interval when duration can't be parsed", async () => {
    await createUpload("uploads/mystery.mov");
    s3ServesRaw(Buffer.from("definitely-not-an-mp4"));
    mediaConvertServesJob();

    await handler(s3Event("uploads/mystery.mov"));

    const posterOutput = createdJobInput().Settings.OutputGroups[1].Outputs[0];
    expect(
      posterOutput.VideoDescription.CodecSettings.FrameCaptureSettings,
    ).toEqual({
      FramerateNumerator: 1,
      FramerateDenominator: 1,
      MaxCaptures: 2,
      Quality: 80,
    });
    // Source dimensions unknown → height cap only, aspect preserved by
    // MediaConvert
    expect(posterOutput.VideoDescription.Width).toBeUndefined();
    expect(posterOutput.VideoDescription.Height).toBe(1080);
    expect(createdJobInput().UserMetadata.posterTargetIndex).toBe("1");
  });

  it("transcodes without rotation correction when detection fails", async () => {
    const upload = await createUpload("uploads/broken.mp4");
    // Valid moov/mvhd but no trak → rotation + dimensions unknown, duration ok
    const moovOnly = Buffer.concat([
      box("ftyp", Buffer.alloc(8)),
      box("moov", mvhdBox(600, 18000)),
    ]);
    s3ServesRaw(moovOnly);
    mediaConvertServesJob();

    await handler(s3Event("uploads/broken.mp4"));

    const job = createdJobInput();
    // No VideoSelector.Rotate on the input
    expect(job.Settings.Inputs[0].VideoSelector).toBeUndefined();
    // Duration still drives the poster capture (30s → interval 3s)
    expect(
      job.Settings.OutputGroups[1].Outputs[0].VideoDescription.CodecSettings
        .FrameCaptureSettings.FramerateDenominator,
    ).toBe(3);
    expect(upload.id).toBeDefined();
  });
});
