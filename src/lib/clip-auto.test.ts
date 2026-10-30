/**
 * Tests for automatic clip seeding (lib/clip-auto) — "any sent order is
 * clip worthy".
 */
import { Clip } from "../entity/Clip";
import { Location } from "../entity/Location";
import { Order, OrderTypes } from "../entity/Order";
import { Report } from "../entity/Report";
import { Upload } from "../entity/Upload";
import { invokeRenderClip } from "./clip-render";
import { seedClipsForOrder, seedUnclippedOrderMedia } from "./clip-auto";

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
});
