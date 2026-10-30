/**
 * Regression tests for issue #349 (BUG-021): feed zap duplicate pictures.
 *
 * zapNewUpload / zapNewMmsUpload must post at most once per upload row,
 * enforced by a DB compare-and-set on uploads.zap_notified_at rather than a
 * read-check. The tests run against the real test database so the Postgres
 * row-lock serialization behind the CAS is exercised for real — including
 * two claims racing via Promise.all (the live incident: five concurrent
 * on-media-format invocations all read media_status='processing').
 */
import { AppDataSource } from "../data-source";
import { zapNewMmsUpload, zapNewUpload } from "./zapier";
import { Upload } from "../entity/Upload";
import { Location } from "../entity/Location";
import { NormalAddress } from "./validator";

const ADDRESS: NormalAddress = {
  latitude: 41.79907,
  longitude: -87.58413,
  fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
  address: "5335 S Kimbark Ave",
  city: "Chicago",
  state: "IL",
  zip: "60615",
};

const ZAP_HOOK_URL = "https://hooks.zapier.com/hooks/catch/123456/announce/";
const WEBP_URL =
  "https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/1/photo.webp";

let location: Location;

/**
 * Ready web upload built through the real entity so column defaults,
 * the eager location relation and the enum checks match production.
 * The location is created once per test (full_address is unique).
 */
async function createWebUpload(
  overrides: Partial<Upload> = {},
): Promise<Upload> {
  const upload = new Upload();
  Object.assign(upload, {
    location,
    ipAddress: "127.0.0.1",
    filePath: `uploads/chicago-il-${Math.random().toString(36).slice(2)}.jpg`,
    rawFilePath: `uploads/chicago-il-${Math.random()
      .toString(36)
      .slice(2)}.jpg`,
    fileHash: `announce-${Math.random().toString(36).slice(2)}`,
    mediaStatus: "ready",
    source: "web",
    processedFilePath: {
      webp: WEBP_URL,
      jpeg: WEBP_URL.replace(/\.webp$/, ".jpeg"),
    },
    ...overrides,
  });
  await upload.save();
  return upload;
}

async function createMmsUpload(
  overrides: Partial<Upload> = {},
): Promise<Upload> {
  return createWebUpload({
    ipAddress: "mms",
    source: "mms",
    sourcePhone: "+14255551234",
    location: null,
    report: null,
    ...overrides,
  });
}

const reload = async (upload: Upload): Promise<Upload> =>
  (await Upload.findOne({ where: { id: upload.id } }))!;

const zapFetchCalls = (): unknown[] =>
  (global.fetch as jest.Mock).mock.calls.filter(
    ([url]) => url === ZAP_HOOK_URL,
  );

beforeEach(async () => {
  // full_address is unique — one location per test, reused by every upload.
  location = await Location.createFromAddress(ADDRESS);
  process.env.ZAP_NEW_UPLOAD = ZAP_HOOK_URL;
  process.env.ZAP_NEW_MMS_UPLOAD = ZAP_HOOK_URL;
});

afterEach(() => {
  delete process.env.ZAP_NEW_UPLOAD;
  delete process.env.ZAP_NEW_MMS_UPLOAD;
});

describe("zapNewUpload announce-once (issue #349)", () => {
  it("two concurrent completion claims emit exactly one webhook payload", async () => {
    const upload = await createWebUpload();

    // Simulates two concurrent pipeline invocations finishing the same
    // upload (S3 fan-out / client PUT retry). The DB compare-and-set must
    // let exactly one of them through.
    await Promise.all([zapNewUpload(upload), zapNewUpload(upload)]);

    expect(zapFetchCalls()).toHaveLength(1);
    expect(zapFetchCalls()[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    // The claim persisted: the notify slot is consumed.
    const stored = await reload(upload);
    expect(stored!.zapNotifiedAt).not.toBeNull();
  });

  it("a sequential second invocation does not post again", async () => {
    const upload = await createWebUpload();

    await zapNewUpload(upload);
    await zapNewUpload(upload);

    expect(zapFetchCalls()).toHaveLength(1);
  });

  it("an already-claimed row (redelivery / migration backfill) never posts", async () => {
    const upload = await createWebUpload({
      zapNotifiedAt: new Date(),
    });

    await zapNewUpload(upload);

    expect(zapFetchCalls()).toHaveLength(0);
  });

  it("does not consume the claim when ZAP_NEW_UPLOAD is unset", async () => {
    delete process.env.ZAP_NEW_UPLOAD;
    const upload = await createWebUpload();

    await zapNewUpload(upload);

    expect(global.fetch).not.toHaveBeenCalled();
    const stored = await reload(upload);
    expect(stored!.zapNotifiedAt).toBeNull();
  });

  it("no-ops for mms-origin uploads (internal channel owns the notify)", async () => {
    const upload = await createMmsUpload();

    await zapNewUpload(upload);

    expect(global.fetch).not.toHaveBeenCalled();
    // Routing decision, not a claim: the MMS hook can still announce it.
    const stored = await reload(upload);
    expect(stored!.zapNotifiedAt).toBeNull();
  });

  it("fails closed when the claim cannot run (no duplicate, no throw)", async () => {
    const upload = await createWebUpload();
    const querySpy = jest
      .spyOn(AppDataSource.manager, "query")
      .mockRejectedValue(new Error("column does not exist"));

    await expect(zapNewUpload(upload)).resolves.toBeUndefined();

    expect(zapFetchCalls()).toHaveLength(0);
    querySpy.mockRestore();
  });

  it("propagates webhook failures after a successful claim (callers wrap fire-and-forget)", async () => {
    const upload = await createWebUpload();
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Zapier is down"),
    );

    // Documented contract: the claim is consumed even if the post fails
    // (at-most-once), and the error surfaces to the caller — the pipeline
    // lambdas wrap zapNewUpload in try/catch so it never flips media_status.
    await expect(zapNewUpload(upload)).rejects.toThrow("Zapier is down");
    expect(zapFetchCalls()).toHaveLength(1);

    // ...and a redelivered event after the failed post stays silent.
    (global.fetch as jest.Mock).mockClear();
    await zapNewUpload(upload);
    expect(zapFetchCalls()).toHaveLength(0);
  });
});

describe("zapNewMmsUpload announce-once (issue #349)", () => {
  it("two concurrent completion claims emit exactly one webhook payload", async () => {
    const upload = await createMmsUpload();

    await Promise.all([zapNewMmsUpload(upload), zapNewMmsUpload(upload)]);

    expect(zapFetchCalls()).toHaveLength(1);
    expect(zapFetchCalls()[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const stored = await reload(upload);
    expect(stored!.zapNotifiedAt).not.toBeNull();
  });

  it("a sequential second invocation does not post again", async () => {
    const upload = await createMmsUpload();

    await zapNewMmsUpload(upload);
    await zapNewMmsUpload(upload);

    expect(zapFetchCalls()).toHaveLength(1);
  });

  it("an already-claimed row never posts", async () => {
    const upload = await createMmsUpload({ zapNotifiedAt: new Date() });

    await zapNewMmsUpload(upload);

    expect(zapFetchCalls()).toHaveLength(0);
  });

  it("fails closed when the claim cannot run (no duplicate, no throw)", async () => {
    const upload = await createMmsUpload();
    const querySpy = jest
      .spyOn(AppDataSource.manager, "query")
      .mockRejectedValue(new Error("column does not exist"));

    await expect(zapNewMmsUpload(upload)).resolves.toBeUndefined();

    expect(zapFetchCalls()).toHaveLength(0);
    querySpy.mockRestore();
  });
});
