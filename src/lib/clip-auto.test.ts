/**
 * Tests for automatic clip seeding (lib/clip-auto) — "any sent order is
 * clip worthy".
 */
import { Clip } from "../entity/Clip";
import { Location } from "../entity/Location";
import { Order, OrderTypes } from "../entity/Order";
import { Report } from "../entity/Report";
import { Truck } from "../entity/Truck";
import { Upload } from "../entity/Upload";
import { invokeRenderClip } from "./clip-render";
import {
  seedClipsForOrder,
  seedClipsForRecentlyFedSkip,
  seedUnclippedOrderMedia,
} from "./clip-auto";

jest.mock("./clip-render", () => ({
  invokeRenderClip: jest.fn(),
}));
const mockInvokeRenderClip = invokeRenderClip as jest.Mock;

let counter = 0;

const makeLocation = async (): Promise<Location> => {
  counter += 1;
  return Location.createFromAddress({
    latitude: 45.523064,
    longitude: -122.676483,
    fullAddress: `900 Seed St, Austin, TX 78701 #${counter}`,
    address: "900 Seed St",
    city: "Austin",
    state: "TX",
    zip: "78701",
  });
};

const makeOrder = async (location: Location): Promise<Order> => {
  const order = new Order();
  order.cost = 120;
  order.snacks = 0;
  order.orderType = OrderTypes.pizzas;
  order.quantity = 8;
  order.restaurant = "Seed Pizzeria";
  order.location = location;
  await order.save();
  return order;
};

/** A report attached to an order, with the upload linked web-style
 * (reports.upload_id). */
const makeOrderReport = async (
  location: Location,
  order: Order,
  upload: Upload | null,
): Promise<Report> => {
  counter += 1;
  const report = new Report();
  report.contactInfo = "5125550100";
  report.reportURL = `https://example.com/reports/seed-${counter}`;
  report.canDistribute = 1;
  report.location = location;
  report.order = order;
  if (upload) report.upload = upload;
  await report.save();
  return report;
};

const makeUpload = async (
  location: Location,
  overrides: Partial<Upload> = {},
): Promise<Upload> => {
  counter += 1;
  const upload = new Upload();
  upload.ipAddress = "127.0.0.1";
  upload.filePath = `uploads/seed-test-${counter}.jpg`;
  upload.fileHash = `seed-hash-${counter}`;
  upload.location = location;
  upload.mediaStatus = "ready";
  Object.assign(upload, overrides);
  await upload.save();
  return upload;
};

/** A report marked skipped — the Location.skip() outcome for a report
 * that arrived after the location's last order. */
const makeSkippedReport = async (
  location: Location,
  upload: Upload | null,
): Promise<Report> => {
  counter += 1;
  const report = new Report();
  report.contactInfo = "5125550100";
  report.reportURL = `https://example.com/reports/skip-${counter}`;
  report.canDistribute = 1;
  report.location = location;
  report.skippedAt = new Date();
  if (upload) report.upload = upload;
  await report.save();
  return report;
};

beforeEach(() => {
  mockInvokeRenderClip.mockClear();
});

describe("seedClipsForOrder", () => {
  it("seeds a queued clip for the order's report upload and fires the render", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    const upload = await makeUpload(location);
    await makeOrderReport(location, order, upload);

    const seeded = await seedClipsForOrder(order);

    expect(seeded).toHaveLength(1);
    expect(seeded[0].status).toEqual("queued");
    expect(seeded[0].upload.id).toEqual(upload.id);
    // Kit carries the report's location, not a caller-supplied city.
    expect(seeded[0].kit.city).toEqual("Austin");
    expect(seeded[0].kit.state).toEqual("TX");
    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(1);
    expect(mockInvokeRenderClip).toHaveBeenCalledWith(seeded[0].id);
  });

  it("skips media that is not ready", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    const upload = await makeUpload(location, { mediaStatus: "processing" });
    await makeOrderReport(location, order, upload);

    const seeded = await seedClipsForOrder(order);

    expect(seeded).toHaveLength(0);
    expect(mockInvokeRenderClip).not.toHaveBeenCalled();
  });

  it("never double-seeds an upload that already has a clip", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    const upload = await makeUpload(location);
    await makeOrderReport(location, order, upload);

    const first = await seedClipsForOrder(order);
    const second = await seedClipsForOrder(order);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(1);
  });

  it("seeds MMS uploads linked to the order's reports", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    const report = await makeOrderReport(location, order, null);

    const mms = await makeUpload(location);
    mms.report = report;
    await mms.save();

    const seeded = await seedClipsForOrder(order);

    expect(seeded).toHaveLength(1);
    expect(seeded[0].upload.id).toEqual(mms.id);
    expect(mockInvokeRenderClip).toHaveBeenCalledWith(seeded[0].id);
  });

  it("seeds nothing for an order with no media", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    await makeOrderReport(location, order, null);

    const seeded = await seedClipsForOrder(order);

    expect(seeded).toHaveLength(0);
  });
});

describe("seedUnclippedOrderMedia", () => {
  it("backstop-seeds recent order-linked media, web and MMS", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    const webUpload = await makeUpload(location);
    await makeOrderReport(location, order, webUpload);

    const mmsReport = await makeOrderReport(location, order, null);
    const mmsUpload = await makeUpload(location);
    mmsUpload.report = mmsReport;
    await mmsUpload.save();

    const seeded = await seedUnclippedOrderMedia();

    expect(seeded).toEqual(2);
    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(2);
  });

  it("ignores uploads whose report has no order", async () => {
    const location = await makeLocation();
    const upload = await makeUpload(location);

    counter += 1;
    const orphan = new Report();
    orphan.contactInfo = "5125550100";
    orphan.reportURL = `https://example.com/reports/orphan-${counter}`;
    orphan.canDistribute = 1;
    orphan.location = location;
    orphan.upload = upload;
    await orphan.save();

    const seeded = await seedUnclippedOrderMedia();

    // No clip for the orphan upload — and no leftover from other tests'
    // fixtures either: the window plus has-a-clip checks filter them.
    const orphanClip = await Clip.findOne({
      where: { upload: { id: upload.id } },
    });
    expect(orphanClip).toBeNull();
    expect(seeded).toEqual(0);
  });

  it("ignores order media older than the seed window", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    const upload = await makeUpload(location);
    const report = await makeOrderReport(location, order, upload);

    // Push both the report and its upload past the 7-day window.
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    report.createdAt = old;
    await Report.update({ id: report.id }, { createdAt: old as never });
    await Upload.update({ id: upload.id }, { createdAt: old as never });

    const seeded = await seedUnclippedOrderMedia();
    expect(seeded).toEqual(0);
    expect(mockInvokeRenderClip).not.toHaveBeenCalled();
  });

  it("does not backfill media on skipped reports (rescue is skip-time only)", async () => {
    const location = await makeLocation();
    // A report skipped at a fed location BEFORE this shipped — e.g.
    // upload 14012, skipped as a duplicate of a fresh order. The
    // backstop must leave it alone: only skips after deploy are rescued.
    await makeOrder(location);
    const upload = await makeUpload(location);
    const report = await makeSkippedReport(location, upload);

    // ... and MMS media linked to it.
    const mms = await makeUpload(location);
    mms.report = report;
    await mms.save();

    const seeded = await seedUnclippedOrderMedia();

    expect(seeded).toEqual(0);
    expect(mockInvokeRenderClip).not.toHaveBeenCalled();
    for (const u of [upload, mms]) {
      const clip = await Clip.findOne({
        where: { upload: { id: u.id } },
      });
      expect(clip).toBeNull();
    }
  });

  /**
   * BUG-042 / issue #407 regression: the backstop must page its window
   * scan (narrow select + take/skip) instead of loading every
   * order-linked report as a full entity in one Data API response —
   * election-day volume blew past the 1 MB cap and killed every run.
   * A local Postgres can't reproduce the cap itself, so this drives the
   * batching behavior directly: more fixtures than one batch holds must
   * all seed across batches, each exactly once, and a re-run must seed
   * nothing (idempotence holds across batch boundaries too).
   */
  it("seeds order-linked web uploads across batches (narrow select + take/skip), each exactly once", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    // 25 ready web uploads → 3 scan batches at batchSize 10.
    const COUNT = 25;
    const uploadIds: number[] = [];
    for (let i = 0; i < COUNT; i++) {
      const upload = await makeUpload(location);
      await makeOrderReport(location, order, upload);
      uploadIds.push(upload.id);
    }

    const seeded = await seedUnclippedOrderMedia(10);

    expect(seeded).toEqual(COUNT);
    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(COUNT);
    for (const id of uploadIds) {
      const clip = await Clip.findOne({ where: { upload: { id } } });
      expect(clip).not.toBeNull();
      expect(clip?.status).toEqual("queued");
    }

    // Idempotent across batches: the second run seeds nothing.
    const reseeded = await seedUnclippedOrderMedia(10);
    expect(reseeded).toEqual(0);
    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(COUNT);
  });

  /**
   * Same batching guarantee for the MMS phase — plus double-seed
   * prevention across batches: an upload that already has a clip (in
   * any status) is skipped during the scan, never re-seeded.
   */
  it("seeds order-linked MMS uploads across batches and never double-seeds uploads that already have a clip", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    const report = await makeOrderReport(location, order, null);

    // An upload that already has a clip — any status counts for
    // idempotence, so use a terminal one.
    const alreadyClipped = await makeUpload(location);
    alreadyClipped.report = report;
    await alreadyClipped.save();
    const priorClip = new Clip();
    priorClip.upload = alreadyClipped;
    priorClip.status = "published";
    await priorClip.save();

    // 15 ready MMS uploads → 2 scan batches at batchSize 10.
    const COUNT = 15;
    const mmsIds: number[] = [];
    for (let i = 0; i < COUNT; i++) {
      const mms = await makeUpload(location);
      mms.report = report;
      await mms.save();
      mmsIds.push(mms.id);
    }

    const seeded = await seedUnclippedOrderMedia(10);

    expect(seeded).toEqual(COUNT);
    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(COUNT);
    // The pre-clipped upload was never re-seeded.
    const priorClips = await Clip.find({
      where: { upload: { id: alreadyClipped.id } },
    });
    expect(priorClips).toHaveLength(1);
    expect(priorClips[0].id).toEqual(priorClip.id);
    for (const id of mmsIds) {
      const clip = await Clip.findOne({ where: { upload: { id } } });
      expect(clip).not.toBeNull();
    }

    // Idempotent across batches: the second run seeds nothing.
    const reseeded = await seedUnclippedOrderMedia(10);
    expect(reseeded).toEqual(0);
    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(COUNT);
  });

  it("never throws when the scan query fails — returns 0", async () => {
    const qbSpy = jest
      .spyOn(Report.getRepository(), "createQueryBuilder")
      .mockImplementationOnce(() => {
        throw new Error(
          "UnsupportedResultException (simulated Data API failure)",
        );
      });

    try {
      const seeded = await seedUnclippedOrderMedia(10);

      expect(seeded).toEqual(0);
      expect(mockInvokeRenderClip).not.toHaveBeenCalled();
    } finally {
      qbSpy.mockRestore();
    }
  });
});

describe("seedClipsForRecentlyFedSkip", () => {
  it("seeds the skipped reports' media when pizza went to the location recently", async () => {
    const location = await makeLocation();
    await makeOrder(location); // the order the skip is "a duplicate of"
    const upload = await makeUpload(location);
    const report = await makeSkippedReport(location, upload);

    const seeded = await seedClipsForRecentlyFedSkip(location, [report]);

    expect(seeded).toHaveLength(1);
    expect(seeded[0].status).toEqual("queued");
    expect(seeded[0].upload.id).toEqual(upload.id);
    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(1);
    expect(mockInvokeRenderClip).toHaveBeenCalledWith(seeded[0].id);
  });

  it("seeds nothing when the skip is a real content rejection (never fed)", async () => {
    const location = await makeLocation();
    const upload = await makeUpload(location);
    const report = await makeSkippedReport(location, upload);

    const seeded = await seedClipsForRecentlyFedSkip(location, [report]);

    expect(seeded).toHaveLength(0);
    expect(mockInvokeRenderClip).not.toHaveBeenCalled();
  });

  it("treats a recent truck assignment as recently fed", async () => {
    const location = await makeLocation();
    const truck = new Truck();
    truck.location = location;
    await truck.save();
    const upload = await makeUpload(location);
    const report = await makeSkippedReport(location, upload);

    const seeded = await seedClipsForRecentlyFedSkip(location, [report]);

    expect(seeded).toHaveLength(1);
  });

  it("rescues when pizza went within the fed window, not just now", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    const upload = await makeUpload(location);
    const report = await makeSkippedReport(location, upload);

    // 2 hours ago — inside the 3-hour window, so the skip is still a
    // duplicate of a fresh delivery.
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await Order.update({ id: order.id }, { createdAt: recent as never });

    const seeded = await seedClipsForRecentlyFedSkip(location, [report]);

    expect(seeded).toHaveLength(1);
    expect(seeded[0].upload.id).toEqual(upload.id);
  });

  it("does not rescue when the last delivery is older than the fed window", async () => {
    const location = await makeLocation();
    const order = await makeOrder(location);
    const upload = await makeUpload(location);
    const report = await makeSkippedReport(location, upload);

    // 4 hours ago — outside the 3-hour window: this skip is a real
    // decision, not a duplicate of a fresh delivery, so nothing seeds.
    const stale = new Date(Date.now() - 4 * 60 * 60 * 1000);
    await Order.update({ id: order.id }, { createdAt: stale as never });

    const seeded = await seedClipsForRecentlyFedSkip(location, [report]);

    expect(seeded).toHaveLength(0);
    expect(mockInvokeRenderClip).not.toHaveBeenCalled();
    const clip = await Clip.findOne({
      where: { upload: { id: upload.id } },
    });
    expect(clip).toBeNull();
  });

  it("is idempotent across repeated rescue calls", async () => {
    const location = await makeLocation();
    await makeOrder(location);
    const upload = await makeUpload(location);
    const report = await makeSkippedReport(location, upload);

    const first = await seedClipsForRecentlyFedSkip(location, [report]);
    const second = await seedClipsForRecentlyFedSkip(location, [report]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(mockInvokeRenderClip).toHaveBeenCalledTimes(1);
  });

  it("seeds MMS replies linked to the skipped report too", async () => {
    const location = await makeLocation();
    await makeOrder(location);
    const report = await makeSkippedReport(location, null);

    const mms = await makeUpload(location);
    mms.report = report;
    await mms.save();

    const seeded = await seedClipsForRecentlyFedSkip(location, [report]);

    expect(seeded).toHaveLength(1);
    expect(seeded[0].upload.id).toEqual(mms.id);
  });

  it("seeds only the reports passed in — no scan for other skipped reports", async () => {
    const location = await makeLocation();
    await makeOrder(location);
    const upload = await makeUpload(location);
    const passed = await makeSkippedReport(location, upload);
    // An older skipped report at the same fed location — the helper has
    // no way to see it (and must not go looking).
    const otherUpload = await makeUpload(location);
    await makeSkippedReport(location, otherUpload);

    const seeded = await seedClipsForRecentlyFedSkip(location, [passed]);

    expect(seeded).toHaveLength(1);
    const otherClip = await Clip.findOne({
      where: { upload: { id: otherUpload.id } },
    });
    expect(otherClip).toBeNull();
  });
});
