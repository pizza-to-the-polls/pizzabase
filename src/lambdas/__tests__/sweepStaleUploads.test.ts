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
 *
 * BUG-035 / issue #394 regression coverage: the sweep's stale-row fetch
 * must filter media_status in SQL (inlined enum literal), select only the
 * four columns it touches, and page/cap the response — the pre-fix
 * full-entity load of every historical row blew the Aurora Data API's
 * 1 MB single-response cap, so every hourly prod run failed before a
 * single S3 HEAD. Tests here seed prod-shaped bulk fixtures (rows large
 * enough to exceed 1 MB serialized) and assert they are neither returned
 * nor touched by the sweep.
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
let SWEEP_BATCH_SIZE: number;
let SWEEP_MAX_BATCHES: number;
let fetchStaleUploadBatch: (
  cutoff: Date,
  afterId: number,
  batchSize?: number,
) => Promise<Upload[]>;

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

let bulkCounter = 0;

/**
 * Seed n bulk rows in one INSERT (per-row save() round trips would be far
 * too slow at 600–1,500 rows), then backdate the whole batch past the
 * grace window in one UPDATE keyed on the unique fileHash tag.
 */
const bulkInsertUploads = async (
  n: number,
  mediaStatus: "processing" | "ready" | "failed",
  opts: { processedPayloadBytes?: number } = {},
): Promise<void> => {
  bulkCounter += 1;
  const tag = `bulk-${bulkCounter}`;
  const rows = Array.from({ length: n }, (_, i) => ({
    ipAddress: "127.0.0.1",
    filePath: `uploads/${tag}-${i}.jpg`,
    fileHash: `${tag}-hash-${i}`,
    rawFilePath: `uploads/${tag}-${i}.jpg`,
    rawBucket: "raw.polls.pizza",
    mediaStatus,
    processedFilePath:
      opts.processedPayloadBytes && mediaStatus === "ready"
        ? { jpeg: `${"p".repeat(opts.processedPayloadBytes)}/${tag}/${i}` }
        : null,
  }));
  await Upload.insert(rows as any);
  // Backdate every row past the 2-hour grace in one statement.
  await Upload.createQueryBuilder()
    .update()
    .set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } as any)
    .where("file_hash LIKE :like", { like: `${tag}-hash-%` })
    .execute();
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
  SWEEP_BATCH_SIZE = mod.SWEEP_BATCH_SIZE;
  SWEEP_MAX_BATCHES = mod.SWEEP_MAX_BATCHES;
  fetchStaleUploadBatch = mod.fetchStaleUploadBatch;
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

  // BUG-035 / #394: the stale-row fetch must filter media_status in SQL
  // (inlined enum literal) and select only the sweep's columns. A JS-side
  // filter would still have returned the ready/fresh rows from the DB.
  it("fetches only stale processing rows, only the sweep's columns", async () => {
    const staleProcessing = await makeProcessingUpload();
    await backdate(staleProcessing);
    // Fresh processing row — inside the grace window; must not be returned.
    await makeProcessingUpload();
    // Historical row in the bulk that broke the 1 MB cap.
    uploadCounter += 1;
    const staleReady = new Upload();
    staleReady.ipAddress = "127.0.0.1";
    staleReady.filePath = `uploads/sweep-test-${uploadCounter}-ready.jpg`;
    staleReady.fileHash = `sweep-test-hash-${uploadCounter}-ready`;
    staleReady.rawFilePath = staleReady.filePath;
    staleReady.rawBucket = "raw.polls.pizza";
    staleReady.mediaStatus = "ready";
    await staleReady.save();
    await backdate(staleReady);

    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const rows = await fetchStaleUploadBatch(cutoff, 0);

    expect(rows.map((r) => r.id)).toEqual([staleProcessing.id]);
    expect(rows[0].mediaStatus).toBe("processing");
    expect(rows[0].rawBucket).toBe("raw.polls.pizza");
    expect(rows[0].rawFilePath).toBe(staleProcessing.rawFilePath);
    // Sparse select: the old full-entity query loaded these; this one does
    // not — a future field read would surface as an undefined, visible
    // change instead of silent over-fetching.
    expect(rows[0].filePath).toBeUndefined();
    expect(rows[0].ipAddress).toBeUndefined();
  });

  it("sweeps a backlog larger than one batch across batches", async () => {
    const total = SWEEP_BATCH_SIZE + 100; // 600 with the current constants
    await bulkInsertUploads(total, "processing");
    mockS3Send.mockImplementation(async () => {
      throw { name: "NotFound" };
    });

    // Pre-check the keyset cursor: exactly one full batch, then the rest.
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const first = await fetchStaleUploadBatch(cutoff, 0);
    expect(first).toHaveLength(SWEEP_BATCH_SIZE);
    const rest = await fetchStaleUploadBatch(
      cutoff,
      first[first.length - 1].id,
    );
    expect(rest).toHaveLength(total - SWEEP_BATCH_SIZE);

    const result = await sweepStaleUploads();
    // The whole backlog fits inside the per-invocation cap.
    expect(result.stale).toEqual(
      Math.min(total, SWEEP_MAX_BATCHES * SWEEP_BATCH_SIZE),
    );
    expect(result).toEqual({
      stale: total,
      failed: total,
      absent: total,
      empty: 0,
    });
    expect(headCalls()).toHaveLength(total);

    const [{ failed }] = await Upload.query(
      "SELECT COUNT(*)::INT AS failed FROM uploads WHERE media_status = 'failed' AND failure_reason = $1",
      [FAILURE_REASON_ABSENT],
    );
    expect(Number(failed)).toEqual(total);
  }, 60_000);

  it("never touches the historical ready/failed bulk that broke the 1 MB cap", async () => {
    const readyCount = 1_200;
    const failedCount = 300;
    await bulkInsertUploads(readyCount, "ready", {
      processedPayloadBytes: 700,
    });
    await bulkInsertUploads(failedCount, "failed");

    // The fixture is prod-shaped: a full-entity fetch of these rows would
    // be > 1 MB of JSON — exactly what the Data API used to reject before
    // every S3 HEAD. (row_to_json measures the logical uncompressed text
    // the driver would ship, unlike pg_column_size which TOAST compresses.)
    const [{ bytes }] = await Upload.query(
      "SELECT SUM(octet_length(row_to_json(t)::text))::BIGINT AS bytes FROM uploads t",
    );
    expect(Number(bytes)).toBeGreaterThan(1_000_000);

    const result = await sweepStaleUploads();

    expect(result).toEqual({ stale: 0, failed: 0, absent: 0, empty: 0 });
    expect(headCalls()).toHaveLength(0); // nothing even HEADed
    expect(await Upload.count({ where: { mediaStatus: "ready" } })).toEqual(
      readyCount,
    );
    expect(await Upload.count({ where: { mediaStatus: "failed" } })).toEqual(
      failedCount,
    );
    expect(
      await Upload.count({ where: { failureReason: FAILURE_REASON_ABSENT } }),
    ).toEqual(0);
  }, 60_000);
});
