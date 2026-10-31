/**
 * Handler tests for the sweepStaleUploads lambda (scheduled stale-upload
 * sweep, BUG-028 / issue #369).
 *
 * S3 is mocked at the SDK boundary (same pattern as compileClips.test.ts):
 * the sweep's HEAD requests run against mockS3Send, which each test wires
 * up to serve a 404 (object never arrived), a 0-byte object, a healthy
 * object, or a transient error. Upload rows live in the real test
 * database so the media_status/failure_reason transitions are verified
 * end-to-end, including the 2-hour grace period (backdated via raw SQL,
 * since created_at is a create-date column).
 */
import { Upload } from "../../entity/Upload";

let sweepStaleUploads: () => Promise<{
  stale: number;
  failed: number;
  absent: number;
  empty: number;
}>;
let FAILURE_REASON_ABSENT: string;
let FAILURE_REASON_EMPTY: string;

const mockS3Send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  const original = jest.requireActual("@aws-sdk/client-s3");
  return {
    ...original,
    S3Client: jest.fn(() => ({ send: mockS3Send })),
    HeadObjectCommand: jest.fn((input: Record<string, unknown>) => ({
      input,
      commandName: "HeadObject",
    })),
  };
});

let uploadCounter = 0;

const makeProcessingUpload = async (opts?: {
  rawBucket?: string | null;
  rawFilePath?: string | null;
}): Promise<Upload> => {
  uploadCounter += 1;
  const upload = new Upload();
  upload.ipAddress = "127.0.0.1";
  upload.filePath = `uploads/sweep-test-${uploadCounter}.jpg`;
  upload.fileHash = `sweep-test-hash-${uploadCounter}`;
  upload.rawFilePath =
    opts?.rawFilePath !== undefined
      ? opts.rawFilePath
      : `uploads/sweep-test-${uploadCounter}.jpg`;
  upload.rawBucket =
    opts?.rawBucket !== undefined ? opts.rawBucket : "raw.polls.pizza";
  upload.mediaStatus = "processing";
  await upload.save();
  return upload;
};

/** Backdate created_at past the 2-hour grace window via raw SQL. */
const backdate = async (upload: Upload, hoursAgo = 3): Promise<void> => {
  await Upload.query("UPDATE uploads SET created_at = $1 WHERE id = $2", [
    new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    upload.id,
  ]);
};

const reload = async (id: number): Promise<Upload> => {
  return (await Upload.findOne({ where: { id } }))!;
};

function headCalls(): any[] {
  return mockS3Send.mock.calls
    .filter(([cmd]: any[]) => cmd.commandName === "HeadObject")
    .map(([cmd]: any[]) => cmd.input);
}

beforeAll(async () => {
  // Imported after the mocks above so the module-level S3Client picks up
  // the mocked constructor.
  const mod = await import("../sweepStaleUploads");
  sweepStaleUploads = mod.sweepStaleUploads;
  FAILURE_REASON_ABSENT = mod.FAILURE_REASON_ABSENT;
  FAILURE_REASON_EMPTY = mod.FAILURE_REASON_EMPTY;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockS3Send.mockImplementation(async () => {
    throw new Error("no mockS3Send implementation set for this test");
  });
});

describe("sweepStaleUploads", () => {
  it("fails a stale row whose raw object never arrived (404)", async () => {
    const upload = await makeProcessingUpload();
    await backdate(upload);
    mockS3Send.mockImplementation(async () => {
      throw { name: "NotFound" };
    });

    const result = await sweepStaleUploads();

    expect(result).toEqual({ stale: 1, failed: 1, absent: 1, empty: 0 });

    const reloaded = await reload(upload.id);
    expect(reloaded.mediaStatus).toBe("failed");
    expect(reloaded.failureReason).toBe(
      "raw object never arrived in S3 (client-side upload never completed)",
    );
    expect(FAILURE_REASON_ABSENT).toBe(
      "raw object never arrived in S3 (client-side upload never completed)",
    );

    // HEAD went to the row's own raw bucket/path.
    expect(headCalls()).toEqual([
      { Bucket: "raw.polls.pizza", Key: upload.rawFilePath },
    ]);

    // updated_at moved naturally when the row was swept.
    expect(reloaded.updatedAt).toBeTruthy();
  });

  it("fails a stale row whose raw object is a 0-byte object", async () => {
    const upload = await makeProcessingUpload();
    await backdate(upload);
    mockS3Send.mockImplementation(async () => ({ ContentLength: 0 }));

    const result = await sweepStaleUploads();

    expect(result).toEqual({ stale: 1, failed: 1, absent: 0, empty: 1 });

    const reloaded = await reload(upload.id);
    expect(reloaded.mediaStatus).toBe("failed");
    expect(reloaded.failureReason).toBe("raw object is empty (zero bytes)");
    expect(FAILURE_REASON_EMPTY).toBe("raw object is empty (zero bytes)");
  });

  it("never touches a fresh row inside the 2-hour grace window", async () => {
    // createdAt defaults to now — well inside the grace window.
    const fresh = await makeProcessingUpload();

    const result = await sweepStaleUploads();

    expect(result).toEqual({ stale: 0, failed: 0, absent: 0, empty: 0 });
    expect(headCalls()).toHaveLength(0);

    const reloaded = await reload(fresh.id);
    expect(reloaded.mediaStatus).toBe("processing");
    expect(reloaded.failureReason).toBeNull();
  });

  it("leaves a stale row with a healthy (non-empty) raw object for the pipeline", async () => {
    const upload = await makeProcessingUpload();
    await backdate(upload);
    mockS3Send.mockImplementation(async () => ({ ContentLength: 2_260_000 }));

    const result = await sweepStaleUploads();

    expect(result).toEqual({ stale: 1, failed: 0, absent: 0, empty: 0 });

    const reloaded = await reload(upload.id);
    expect(reloaded.mediaStatus).toBe("processing");
    expect(reloaded.failureReason).toBeNull();
  });

  it("treats a stale row with no raw bucket/path as never-arrived without calling S3", async () => {
    const upload = await makeProcessingUpload({
      rawBucket: null,
      rawFilePath: null,
    });
    await backdate(upload);

    const result = await sweepStaleUploads();

    expect(result).toEqual({ stale: 1, failed: 1, absent: 1, empty: 0 });
    expect(headCalls()).toHaveLength(0);

    const reloaded = await reload(upload.id);
    expect(reloaded.mediaStatus).toBe("failed");
    expect(reloaded.failureReason).toBe(
      "raw object never arrived in S3 (client-side upload never completed)",
    );
  });

  it("skips a stale row on a transient S3 error instead of failing it", async () => {
    const upload = await makeProcessingUpload();
    await backdate(upload);
    // Anything that is not a definitive 404 (e.g. AccessDenied on a
    // misconfigured bucket, 500s, network errors) must NOT mass-fail rows.
    mockS3Send.mockImplementation(async () => {
      throw { name: "AccessDenied", message: "Access Denied" };
    });

    const result = await sweepStaleUploads();

    expect(result).toEqual({ stale: 1, failed: 0, absent: 0, empty: 0 });

    const reloaded = await reload(upload.id);
    expect(reloaded.mediaStatus).toBe("processing");
    expect(reloaded.failureReason).toBeNull();
  });

  it("sweeps a mixed batch: fails only the broken rows, counts per-class", async () => {
    const absentRow = await makeProcessingUpload();
    await backdate(absentRow);
    const emptyRow = await makeProcessingUpload();
    await backdate(emptyRow);
    const healthyRow = await makeProcessingUpload();
    await backdate(healthyRow);
    const freshRow = await makeProcessingUpload(); // grace window

    const keyFor = new Map<number, string>([
      [absentRow.id, absentRow.rawFilePath],
      [emptyRow.id, emptyRow.rawFilePath],
      [healthyRow.id, healthyRow.rawFilePath],
    ]);
    mockS3Send.mockImplementation(async (cmd: any) => {
      const key = cmd.input.Key;
      if (key === keyFor.get(absentRow.id)) throw { name: "NotFound" };
      if (key === keyFor.get(emptyRow.id)) return { ContentLength: 0 };
      if (key === keyFor.get(healthyRow.id))
        return { ContentLength: 2_260_000 };
      throw new Error(`unexpected HEAD for ${key}`);
    });

    const result = await sweepStaleUploads();

    // 3 stale rows (freshRow excluded by the grace window), 2 failed.
    expect(result).toEqual({ stale: 3, failed: 2, absent: 1, empty: 1 });

    expect((await reload(absentRow.id)).mediaStatus).toBe("failed");
    expect((await reload(emptyRow.id)).mediaStatus).toBe("failed");
    expect((await reload(healthyRow.id)).mediaStatus).toBe("processing");
    expect((await reload(freshRow.id)).mediaStatus).toBe("processing");
  });

  it("emits one structured upload_sweep log line per run", async () => {
    const upload = await makeProcessingUpload();
    await backdate(upload);
    mockS3Send.mockImplementation(async () => {
      throw { name: "NotFound" };
    });

    const logSpy = jest.spyOn(console, "log");
    try {
      await sweepStaleUploads();
    } finally {
      // Inspect calls before restoring; the spy passthrough still printed.
      const sweepLogs = logSpy.mock.calls
        .map((args) => String(args[0]))
        .filter((line) => line.includes('"upload_sweep"'));
      expect(sweepLogs).toHaveLength(1);
      expect(JSON.parse(sweepLogs[0])).toEqual({
        event: "upload_sweep",
        stale: 1,
        failed: 1,
        absent: 1,
        empty: 0,
      });
      logSpy.mockRestore();
    }
  });

  it("does not clobber a row the pipeline flipped forward mid-sweep", async () => {
    const upload = await makeProcessingUpload();
    await backdate(upload);

    mockS3Send.mockImplementation(async () => {
      // Race window: the pipeline flips the row to 'ready' (via a real
      // media-format callback) after the sweep's SELECT but before the
      // sweep's write. Simulate that by flipping the row in the DB at the
      // exact moment the sweep HEADs the object.
      await Upload.query(
        "UPDATE uploads SET media_status = 'ready' WHERE id = $1",
        [upload.id],
      );
      throw { name: "NotFound" };
    });

    const result = await sweepStaleUploads();

    // The HEAD saw a 404, but the row was no longer 'processing' when the
    // sweep re-read it to fail it — it must stay 'ready' with no reason.
    expect(result.failed).toBe(0);
    const reloaded = await reload(upload.id);
    expect(reloaded.mediaStatus).toBe("ready");
    expect(reloaded.failureReason).toBeNull();
  });
});
