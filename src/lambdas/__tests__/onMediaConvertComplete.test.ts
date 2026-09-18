/**
 * Unit tests for the on-mediaconvert-complete lambda (poster frame capture).
 *
 * Verifies the EventBridge → processed_file_path contract against the real
 * test database: the MP4 URL, the poster S3 key picked from the frame-capture
 * output group, jobId retention, and terminal-state handling. The S3 client
 * is mocked to serve ftyp bytes for the brand normalization step.
 */
import { Upload } from "../../entity/Upload";
import { Location } from "../../entity/Location";

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

const BUCKET = "reports.polls.pizza";

let handler: (event: unknown) => Promise<void>;

beforeAll(async () => {
  // Imported after the mock above so the module-level S3Client picks up the
  // mocked constructor.
  ({ handler } = await import("../onMediaConvertComplete"));
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal ISO BMFF ftyp box with the given major brand. */
function ftypBuffer(brand: string): Buffer {
  const b = Buffer.alloc(20);
  b.writeUInt32BE(20, 0);
  b.write("ftyp", 4, "latin1");
  b.write(brand, 8, "latin1");
  return b;
}

/** Serve ftyp bytes for the brand-normalization GetObject; accept puts. */
function s3ServesProcessedMp4(brand = "isom") {
  mockS3Send.mockImplementation(async (cmd: any) => {
    if (cmd.commandName === "GetObject") {
      return { Body: { transformToByteArray: async () => ftypBuffer(brand) } };
    }
    return {}; // PutObject
  });
}

async function createUploadWithJob(
  jobId: string,
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
  upload.filePath = `uploads/${jobId}/clip.mp4`;
  upload.fileHash = `hash-${jobId}`;
  upload.rawFilePath = `uploads/${jobId}/clip.mp4`;
  upload.mediaStatus = "processing";
  upload.processedFilePath = { jobId };
  Object.assign(upload, overrides);
  await upload.save();
  return upload;
}

interface CompleteEventOpts {
  jobId: string;
  status?: "COMPLETE" | "ERROR" | "PROGRESSING";
  mp4Path?: string;
  posterPaths?: string[];
  userMetadata?: Record<string, string>;
}

function mediaConvertEvent(opts: CompleteEventOpts) {
  const outputGroupDetails: unknown[] = [];
  if (opts.mp4Path) {
    outputGroupDetails.push({
      outputDetails: [{ outputFilePaths: [opts.mp4Path] }],
    });
  }
  if (opts.posterPaths) {
    outputGroupDetails.push({
      outputDetails: [{ outputFilePaths: opts.posterPaths }],
    });
  }
  return {
    detail: {
      status: opts.status ?? "COMPLETE",
      jobId: opts.jobId,
      ...(opts.userMetadata ? { userMetadata: opts.userMetadata } : {}),
      ...(outputGroupDetails.length ? { outputGroupDetails } : {}),
    },
  };
}

/** Realistic paths for a job set up by on-media-format. */
function jobPaths(uploadId: number, posterCount: number) {
  const mp4Path = `s3://${BUCKET}/uploads/${uploadId}/clip_transcoded.mp4`;
  const posterPaths = Array.from(
    { length: posterCount },
    (_, i) => `s3://${BUCKET}/uploads/${uploadId}/clip_poster.000000${i}.jpg`,
  );
  return { mp4Path, posterPaths };
}

function putObjectCalls(): any[] {
  return mockS3Send.mock.calls
    .filter(([cmd]: any[]) => cmd.commandName === "PutObject")
    .map(([cmd]: any[]) => cmd.input);
}

beforeEach(() => {
  mockS3Send.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("on-mediaconvert-complete", () => {
  it("stores the poster key from the frame-capture group on COMPLETE", async () => {
    const upload = await createUploadWithJob("job-complete-1");
    const { mp4Path, posterPaths } = jobPaths(upload.id, 4);
    s3ServesProcessedMp4("isom");

    await handler(
      mediaConvertEvent({
        jobId: "job-complete-1",
        mp4Path,
        posterPaths,
        userMetadata: {
          uploadId: String(upload.id),
          posterTargetIndex: "1",
        },
      }),
    );

    const updated = (await Upload.findOne({
      where: { id: upload.id },
    }))!;
    expect(updated.mediaStatus).toBe("ready");
    expect(updated.processedFilePath).toEqual({
      mp4: `https://s3.us-west-2.amazonaws.com/${BUCKET}/uploads/${upload.id}/clip_transcoded.mp4`,
      // 0-based capture #1 → second (chronologically sorted) frame, stored as
      // a bare S3 key
      poster: `uploads/${upload.id}/clip_poster.0000001.jpg`,
      jobId: "job-complete-1",
    });
    // isom brand already canonical → no rewrite
    expect(putObjectCalls()).toHaveLength(0);
  });

  it("omits the poster key when the job has no frame-capture group", async () => {
    const upload = await createUploadWithJob("job-no-poster");
    const { mp4Path } = jobPaths(upload.id, 0);
    s3ServesProcessedMp4();

    await handler(
      mediaConvertEvent({
        jobId: "job-no-poster",
        mp4Path,
        userMetadata: { uploadId: String(upload.id) },
      }),
    );

    const updated = (await Upload.findOne({
      where: { id: upload.id },
    }))!;
    expect(updated.mediaStatus).toBe("ready");
    const processed = updated.processedFilePath!;
    expect(processed.mp4).toContain("clip_transcoded.mp4");
    expect("poster" in processed).toBe(false);
    expect(Object.keys(processed).sort()).toEqual(["jobId", "mp4"]);
  });

  it("clamps the poster index to the last capture for short videos", async () => {
    const upload = await createUploadWithJob("job-short");
    const { mp4Path, posterPaths } = jobPaths(upload.id, 2);
    s3ServesProcessedMp4();

    await handler(
      mediaConvertEvent({
        jobId: "job-short",
        mp4Path,
        posterPaths,
        // Target capture #5 but the video only produced 2 frames
        userMetadata: { uploadId: String(upload.id), posterTargetIndex: "5" },
      }),
    );

    const updated = (await Upload.findOne({
      where: { id: upload.id },
    }))!;
    expect(updated.processedFilePath!.poster).toBe(
      `uploads/${upload.id}/clip_poster.0000001.jpg`,
    );
  });

  it("marks the upload failed on ERROR and keeps jobId", async () => {
    const upload = await createUploadWithJob("job-error");

    await handler(mediaConvertEvent({ jobId: "job-error", status: "ERROR" }));

    const updated = (await Upload.findOne({
      where: { id: upload.id },
    }))!;
    expect(updated.mediaStatus).toBe("failed");
    expect(updated.processedFilePath).toEqual({ jobId: "job-error" });
  });

  it("patches the M4V ftyp brand to isom via PutObject", async () => {
    const upload = await createUploadWithJob("job-brand");
    const { mp4Path } = jobPaths(upload.id, 0);
    s3ServesProcessedMp4("M4V ");

    await handler(
      mediaConvertEvent({
        jobId: "job-brand",
        mp4Path,
        userMetadata: { uploadId: String(upload.id) },
      }),
    );

    const updated = (await Upload.findOne({
      where: { id: upload.id },
    }))!;
    expect(updated.mediaStatus).toBe("ready");

    const puts = putObjectCalls();
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({
      Bucket: BUCKET,
      Key: `uploads/${upload.id}/clip_transcoded.mp4`,
      ContentType: "video/mp4",
    });
    // Brand rewritten in place
    expect((puts[0].Body as Buffer).toString("latin1", 8, 12)).toBe("isom");
  });

  it("resolves legacy jobs by jobId when userMetadata is absent", async () => {
    await createUploadWithJob("legacy-job-9");
    const mp4Path = `s3://${BUCKET}/uploads/legacy/clip_transcoded.mp4`;
    s3ServesProcessedMp4();

    await handler(mediaConvertEvent({ jobId: "legacy-job-9", mp4Path }));

    const updated = await Upload.createQueryBuilder("u")
      .where("u.processed_file_path ->> 'jobId' = :jobId", {
        jobId: "legacy-job-9",
      })
      .getOne();
    expect(updated).not.toBeNull();
    expect(updated!.mediaStatus).toBe("ready");
    expect(updated!.processedFilePath!.mp4).toContain("clip_transcoded.mp4");
  });

  it("does nothing when no upload matches the job", async () => {
    await expect(
      handler(
        mediaConvertEvent({
          jobId: "unknown-job",
          mp4Path: `s3://${BUCKET}/uploads/999/clip_transcoded.mp4`,
          userMetadata: { uploadId: "999999" },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("ignores non-terminal job statuses", async () => {
    const upload = await createUploadWithJob("job-progressing");

    await expect(
      handler(
        mediaConvertEvent({ jobId: "job-progressing", status: "PROGRESSING" }),
      ),
    ).resolves.toBeUndefined();

    const updated = (await Upload.findOne({
      where: { id: upload.id },
    }))!;
    expect(updated.mediaStatus).toBe("processing");
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});
