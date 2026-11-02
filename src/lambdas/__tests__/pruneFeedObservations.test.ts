/**
 * Tests for the prune-feed-observations lambda (selective retention).
 *
 * Real inserts + real deletes against the local jest Postgres — the whole
 * point is the policy and its SQL, so nothing is mocked except Bugsnag.
 * The prune's SQL must also work against the prod Aurora Data API driver
 * (scalar binds only, no JS array parameters), which these queries respect
 * by construction; the postgres test driver exercises the same statements.
 */
import { AppDataSource } from "../../data-source";
import { FeedObservation } from "../../entity/FeedObservation";
import { notifyBugsnag } from "../../lib/notifyBugsnag";

jest.mock("../../lib/notifyBugsnag", () => ({
  notifyBugsnag: jest.fn(),
}));

const mockNotifyBugsnag = notifyBugsnag as jest.Mock;

type PruneModule = typeof import("../pruneFeedObservations");

let runPrune: PruneModule["runPrune"];
let parseRetentionDays: PruneModule["parseRetentionDays"];
let DEFAULT_BATCH_SIZE: number;
let DEFAULT_MAX_BATCHES: number;

beforeAll(async () => {
  ({ runPrune, parseRetentionDays, DEFAULT_BATCH_SIZE, DEFAULT_MAX_BATCHES } =
    await import("../pruneFeedObservations"));
});

const DAY_MS = 24 * 3600 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

let sourceCounter = 0;

const saveObservation = async (
  overrides: Partial<FeedObservation> = {},
): Promise<FeedObservation> => {
  sourceCounter += 1;
  const o = new FeedObservation();
  o.domain = overrides.domain ?? "govt";
  o.sourceRef = overrides.sourceRef ?? `test:prune-${sourceCounter}`;
  o.observedAt = overrides.observedAt ?? daysAgo(1);
  o.signalKind = overrides.signalKind ?? "wait_time_reading";
  o.confidence = overrides.confidence ?? 0.9;
  o.relevant = overrides.relevant ?? null;
  o.description = overrides.description ?? { caption: "test observation" };
  await o.save();
  return o;
};

/** Bulk-insert n prunable govt rows older than any reasonable window. */
const saveOldGovtRows = async (n: number, ageDays = 40): Promise<void> => {
  const base = Date.now() - ageDays * DAY_MS;
  const rows: FeedObservation[] = [];
  for (let i = 0; i < n; i++) {
    sourceCounter += 1;
    const o = new FeedObservation();
    o.domain = "govt";
    o.sourceRef = `test:bulk-${sourceCounter}`;
    o.observedAt = new Date(base + i); // distinct observed_at per row
    o.signalKind = "wait_time_reading";
    o.confidence = 0.9;
    o.description = { caption: "bulk" };
    rows.push(o);
  }
  await AppDataSource.getRepository(FeedObservation).insert(rows);
};

const countAll = async (): Promise<number> => await FeedObservation.count();
const countBySourceRef = async (sourceRef: string): Promise<number> =>
  await FeedObservation.count({ where: { sourceRef } });

beforeEach(() => {
  mockNotifyBugsnag.mockClear();
});

afterEach(() => {
  delete process.env.RETENTION_DAYS;
  // Restore any spyOn (e.g. the manager.query failure test) so a failing
  // test can't leave the shared EntityManager broken for later tests.
  jest.restoreAllMocks();
});

// ── parseRetentionDays (the digest floor) ──────────────────────────────

describe("parseRetentionDays", () => {
  it("defaults to 30 when unset, empty, or blank", () => {
    expect(parseRetentionDays(undefined)).toEqual(30);
    expect(parseRetentionDays("")).toEqual(30);
    expect(parseRetentionDays("  ")).toEqual(30);
  });

  it("accepts valid integers", () => {
    expect(parseRetentionDays("2")).toEqual(2);
    expect(parseRetentionDays("7")).toEqual(7);
    expect(parseRetentionDays("90")).toEqual(90);
  });

  it("rejects non-integer and non-positive values", () => {
    expect(() => parseRetentionDays("abc")).toThrow(/positive integer/);
    expect(() => parseRetentionDays("1.5")).toThrow(/positive integer/);
    expect(() => parseRetentionDays("0")).toThrow(/positive integer/);
    expect(() => parseRetentionDays("-5")).toThrow(/positive integer/);
  });

  it("rejects 1 — would starve the digest's ~26h window", () => {
    // The load-bearing constraint, encoded: RETENTION_DAYS=1 must be a
    // refused run, not a prod digest outage at 02:00 UTC.
    expect(() => parseRetentionDays("1")).toThrow(/must be >= 2/);
    expect(() => parseRetentionDays("1")).toThrow(/digest/);
  });
});

// ── runPrune against the real test database ────────────────────────────

describe("runPrune", () => {
  // Test 1: the policy matrix — crowd + relevant social kept forever;
  // govt + irrelevant social pruned past the watermark; recency keeps
  // everything inside the window.
  it("deletes old govt and old irrelevant-social rows only", async () => {
    process.env.RETENTION_DAYS = "2";
    const oldGovt = await saveObservation({
      domain: "govt",
      observedAt: daysAgo(3),
    });
    const newGovt = await saveObservation({
      domain: "govt",
      observedAt: daysAgo(1),
    });
    const oldIrrelevantSocial = await saveObservation({
      domain: "social",
      relevant: false,
      observedAt: daysAgo(3),
      signalKind: "irrelevant",
    });
    const newIrrelevantSocial = await saveObservation({
      domain: "social",
      relevant: false,
      observedAt: daysAgo(1),
      signalKind: "irrelevant",
    });
    // Exemptions — old but kept under the policy:
    const oldRelevantSocial = await saveObservation({
      domain: "social",
      relevant: true,
      observedAt: daysAgo(3),
    });
    const oldCrowd = await saveObservation({
      domain: "crowd",
      signalKind: "user_report",
      observedAt: daysAgo(3),
    });

    const result = await runPrune({ batchSize: 100, maxBatches: 5 });

    expect(result.totalDeleted).toEqual(2);
    expect(result.batchesRun).toEqual(1);
    expect(await countBySourceRef(oldGovt.sourceRef)).toEqual(0);
    expect(await countBySourceRef(oldIrrelevantSocial.sourceRef)).toEqual(0);
    expect(await countBySourceRef(newGovt.sourceRef)).toEqual(1);
    expect(await countBySourceRef(newIrrelevantSocial.sourceRef)).toEqual(1);
    expect(await countBySourceRef(oldRelevantSocial.sourceRef)).toEqual(1);
    expect(await countBySourceRef(oldCrowd.sourceRef)).toEqual(1);
    // Summary semantics: keptCount counts the corpus kept FOREVER under
    // the policy (crowd + relevant social) — the two in-window prunable
    // rows remain too, but they are only kept by recency, not policy.
    expect(result.keptCount).toEqual(2);
    expect(result.totalRemaining).toEqual(4);
  });

  // NULL relevant counts as not-relevant for social rows (COALESCE) — an
  // irrelevant-classified row must not survive on a technicality.
  it("prunes old social rows with relevant = NULL", async () => {
    process.env.RETENTION_DAYS = "2";
    const oldNullSocial = await saveObservation({
      domain: "social",
      relevant: null,
      observedAt: daysAgo(3),
    });

    const result = await runPrune({ batchSize: 100, maxBatches: 5 });

    expect(result.totalDeleted).toEqual(1);
    expect(await countBySourceRef(oldNullSocial.sourceRef)).toEqual(0);
  });

  // Test 2: the floor — RETENTION_DAYS=1 refuses the run and deletes
  // nothing; =2 proceeds.
  it("refuses to run and deletes nothing when RETENTION_DAYS=1", async () => {
    process.env.RETENTION_DAYS = "1";
    const oldGovt = await saveObservation({
      domain: "govt",
      observedAt: daysAgo(100),
    });
    const before = await countAll();
    expect(before).toBeGreaterThan(0);

    await expect(runPrune()).rejects.toThrow(/must be >= 2/);

    expect(await countAll()).toEqual(before);
    expect(await countBySourceRef(oldGovt.sourceRef)).toEqual(1);
    expect(mockNotifyBugsnag).not.toHaveBeenCalled();
  });

  it("proceeds when RETENTION_DAYS=2", async () => {
    process.env.RETENTION_DAYS = "2";
    const oldGovt = await saveObservation({
      domain: "govt",
      observedAt: daysAgo(3),
    });

    const result = await runPrune({ batchSize: 100, maxBatches: 5 });

    expect(result.totalDeleted).toEqual(1);
    expect(await countBySourceRef(oldGovt.sourceRef)).toEqual(0);
  });

  // Test 3: batching/resumability — a run deletes batch after batch under
  // the per-invocation cap, and the next run resumes where it stopped.
  it("batch cap stops the run; the next run resumes", async () => {
    process.env.RETENTION_DAYS = "2";
    await saveOldGovtRows(250); // all older than the 2-day watermark

    // Cap at 2 batches of 100: exactly 200 gone, 50 remain for tomorrow.
    const first = await runPrune({ batchSize: 100, maxBatches: 2 });
    expect(first.totalDeleted).toEqual(200);
    expect(first.batchesRun).toEqual(2);

    const mid = await countAll();
    expect(mid).toEqual(50);

    // Next day's run resumes and finishes the backlog.
    const second = await runPrune({ batchSize: 100, maxBatches: 25 });
    expect(second.totalDeleted).toEqual(50);
    expect(await countAll()).toEqual(0);
  });

  it("stops early when a batch deletes fewer than batchSize", async () => {
    process.env.RETENTION_DAYS = "2";
    await saveOldGovtRows(50);

    const result = await runPrune({ batchSize: 100, maxBatches: 25 });

    // 50 rows < batchSize → one batch, loop exits without a 0-row probe.
    expect(result.totalDeleted).toEqual(50);
    expect(result.batchesRun).toEqual(1);
    expect(await countAll()).toEqual(0);
  });

  // Test 4: idempotence — a second run over a pruned table is a no-op.
  it("idempotent: second run over a pruned table deletes 0", async () => {
    process.env.RETENTION_DAYS = "2";
    await saveObservation({ domain: "govt", observedAt: daysAgo(3) });
    await runPrune({ batchSize: 100, maxBatches: 5 });
    const afterFirst = await countAll();

    const second = await runPrune({ batchSize: 100, maxBatches: 5 });

    expect(second.totalDeleted).toEqual(0);
    expect(second.batchesRun).toEqual(0);
    expect(await countAll()).toEqual(afterFirst);
  });

  // Test 5: default safety — RETENTION_DAYS unset means the 30-day
  // default, not "delete everything".
  it("uses the 30-day default when RETENTION_DAYS is unset", async () => {
    delete process.env.RETENTION_DAYS;
    const ancient = await saveObservation({
      domain: "govt",
      observedAt: daysAgo(31),
    });
    const recent = await saveObservation({
      domain: "govt",
      observedAt: daysAgo(10),
    });

    const result = await runPrune({ batchSize: 100, maxBatches: 5 });

    expect(result.totalDeleted).toEqual(1);
    expect(await countBySourceRef(ancient.sourceRef)).toEqual(0);
    expect(await countBySourceRef(recent.sourceRef)).toEqual(1);
  });

  it("keeps the corpus: old crowd and relevant-social rows stay", async () => {
    process.env.RETENTION_DAYS = "30";
    const ancientCrowd = await saveObservation({
      domain: "crowd",
      observedAt: daysAgo(365),
      signalKind: "user_report",
    });
    const ancientRelevantSocial = await saveObservation({
      domain: "social",
      relevant: true,
      observedAt: daysAgo(365),
    });

    const result = await runPrune({ batchSize: 100, maxBatches: 5 });

    expect(result.totalDeleted).toEqual(0);
    expect(await countBySourceRef(ancientCrowd.sourceRef)).toEqual(1);
    expect(await countBySourceRef(ancientRelevantSocial.sourceRef)).toEqual(1);
    expect(result.keptCount).toEqual(2);
  });

  it("never prunes rows inside the window, whatever their domain", async () => {
    process.env.RETENTION_DAYS = "30";
    const fresh = await saveObservation({
      domain: "govt",
      observedAt: daysAgo(0.5),
    });

    const result = await runPrune({ batchSize: 100, maxBatches: 5 });

    expect(result.totalDeleted).toEqual(0);
    expect(await countBySourceRef(fresh.sourceRef)).toEqual(1);
  });

  it("fails loudly: notify Bugsnag and re-throw on SQL error", async () => {
    process.env.RETENTION_DAYS = "2";
    await saveObservation({ domain: "govt", observedAt: daysAgo(3) });

    const spy = jest
      .spyOn(AppDataSource.manager, "query")
      .mockRejectedValueOnce(new Error("Data API exploded"));

    await expect(runPrune({ batchSize: 100, maxBatches: 5 })).rejects.toThrow(
      /Data API exploded/,
    );

    expect(mockNotifyBugsnag).toHaveBeenCalledTimes(1);
    expect(mockNotifyBugsnag.mock.calls[0][0]).toBeInstanceOf(Error);
    spy.mockRestore();
  });

  it("exports the documented batch defaults", () => {
    expect(DEFAULT_BATCH_SIZE).toEqual(10_000);
    expect(DEFAULT_MAX_BATCHES).toEqual(25);
  });
});

// ── handler ────────────────────────────────────────────────────────────

describe("handler", () => {
  it("initializes the data source and runs the prune", async () => {
    const { handler } = await import("../pruneFeedObservations");
    process.env.RETENTION_DAYS = "2";
    await saveObservation({ domain: "govt", observedAt: daysAgo(3) });

    // The scheduled event payload (unused, but passed through like prod).
    await expect(
      handler({ detailType: "Scheduled Event" }),
    ).resolves.toBeUndefined();

    expect(await countAll()).toEqual(0);
  });

  it("propagates validation failure: invocation marked failed", async () => {
    const { handler } = await import("../pruneFeedObservations");
    process.env.RETENTION_DAYS = "1";

    await expect(handler({})).rejects.toThrow(/must be >= 2/);
  });
});
