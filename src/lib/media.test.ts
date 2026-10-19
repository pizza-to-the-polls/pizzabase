import { collectMedia } from "./media";
import { Order, OrderTypes } from "../entity/Order";
import { Report } from "../entity/Report";
import { Location } from "../entity/Location";
import { Upload } from "../entity/Upload";
import { AppDataSource } from "../data-source";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestOrder(): Promise<Order> {
  const location = await Location.createFromAddress({
    latitude: 41.79907,
    longitude: -87.58413,
    fullAddress: "900 Test Blvd Chicago IL 60615",
    address: "900 Test Blvd",
    city: "Chicago",
    state: "IL",
    zip: "60615",
  });

  return Order.placeOrder(
    { quantity: 5, orderType: OrderTypes.pizzas, cost: 100 },
    location,
  );
}

async function addUpload(
  order: Order,
  filePath: string,
  ageMinutes: number = 0,
  report?: Report,
): Promise<Upload> {
  const upload = new Upload();
  upload.location = order.location;
  upload.ipAddress = "127.0.0.1";
  upload.filePath = filePath;
  upload.fileHash = `hash-${filePath}`;
  if (report) upload.report = report;
  await upload.save();
  if (ageMinutes > 0) {
    await AppDataSource.getRepository(Upload).update(
      { id: upload.id },
      { createdAt: new Date(Date.now() - ageMinutes * 60 * 1000) as never },
    );
  }
  return upload;
}

async function addReport(
  order: Order,
  {
    reportURL = "https://polls.pizza/uploads/report.jpg",
    upload = null,
    ageMinutes = 0,
  }: {
    reportURL?: string;
    upload?: Upload | null;
    ageMinutes?: number;
  } = {},
): Promise<Report> {
  const report = new Report();
  report.contactInfo = "3125550100";
  report.reportURL = reportURL;
  report.location = order.location;
  report.order = order;
  if (upload) report.upload = upload;
  await report.save();
  if (ageMinutes > 0) {
    await AppDataSource.getRepository(Report).update(
      { id: report.id },
      { createdAt: new Date(Date.now() - ageMinutes * 60 * 1000) as never },
    );
  }
  return report;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectMedia", () => {
  it("uses the web upload attached to the order's report", async () => {
    const order = await createTestOrder();
    const upload = await addUpload(order, "uploads/line.jpg");
    await addReport(order, { upload });

    const media = await collectMedia(order);

    expect(media.images).toHaveLength(1);
    expect(media.images[0]).toContain("line.jpg");
  });

  it("ignores uploads at the location that belong to no report of the order", async () => {
    const order = await createTestOrder();
    // An old photo from a previous election cycle, still tied to the
    // location but not to any report this order was placed against.
    await addUpload(order, "uploads/last-election.jpg", 60 * 24 * 365);
    const upload = await addUpload(order, "uploads/line.jpg");
    await addReport(order, { upload });

    const media = await collectMedia(order);

    expect(media.images).toHaveLength(1);
    expect(media.images[0]).toContain("line.jpg");
  });

  it("includes MMS uploads linked to the order's reports", async () => {
    const order = await createTestOrder();
    const report = await addReport(order);
    await addUpload(order, "uploads/mms-reply.jpg", 5, report);

    const media = await collectMedia(order);

    expect(media.images).toHaveLength(1);
    expect(media.images[0]).toContain("mms-reply.jpg");
  });

  it("sorts media newest first", async () => {
    const order = await createTestOrder();
    const older = await addUpload(order, "uploads/older.jpg", 50);
    const newer = await addUpload(order, "uploads/newer.jpg", 40);
    await addReport(order, { upload: older, ageMinutes: 50 });
    await addReport(order, { upload: newer, ageMinutes: 40 });

    const media = await collectMedia(order);

    expect(media.images).toHaveLength(2);
    expect(media.images[0]).toContain("newer.jpg");
    expect(media.images[1]).toContain("older.jpg");
  });

  it("caps images at four and videos at one", async () => {
    const order = await createTestOrder();
    for (const [file, age] of [
      ["uploads/p1.jpg", 50],
      ["uploads/p2.jpg", 49],
      ["uploads/p3.jpg", 48],
      ["uploads/p4.jpg", 47],
      ["uploads/p5.jpg", 46],
      ["uploads/v1.mp4", 45],
      ["uploads/v2.mp4", 44],
    ] as const) {
      const upload = await addUpload(order, file, age);
      await addReport(order, { upload, ageMinutes: age });
    }

    const media = await collectMedia(order);

    expect(media.images).toHaveLength(4);
    expect(media.videos).toHaveLength(1);
  });

  it("falls back to the report's public URL when there is no upload", async () => {
    const order = await createTestOrder();
    await addReport(order, {
      reportURL: "https://polls.pizza/uploads/legacy-line.jpg",
    });

    const media = await collectMedia(order);

    expect(media.images).toEqual([
      "https://polls.pizza/uploads/legacy-line.jpg",
    ]);
  });

  it("skips non-media report URLs", async () => {
    const order = await createTestOrder();
    await addReport(order, {
      reportURL: "https://polls.pizza/report-submitted",
    });

    const media = await collectMedia(order);

    expect(media.images).toHaveLength(0);
    expect(media.videos).toHaveLength(0);
  });

  it("serves pipeline uploads from their processed output", async () => {
    const order = await createTestOrder();
    const upload = new Upload();
    upload.location = order.location;
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/pipeline.mp4";
    upload.fileHash = "hash-pipeline";
    upload.rawFilePath = "uploads/pipeline.mp4";
    upload.mediaStatus = "ready";
    upload.processedFilePath = {
      mp4: "https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/99/pipeline_transcoded.mp4",
    };
    await upload.save();
    await addReport(order, { upload });

    const media = await collectMedia(order);

    expect(media.videos).toEqual([
      "https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/99/pipeline_transcoded.mp4",
    ]);
  });

  it("skips pipeline uploads that are not ready", async () => {
    const order = await createTestOrder();
    const upload = new Upload();
    upload.location = order.location;
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/processing.mp4";
    upload.fileHash = "hash-processing";
    upload.rawFilePath = "uploads/processing.mp4";
    upload.mediaStatus = "processing";
    await upload.save();
    await addReport(order, { upload });

    const media = await collectMedia(order);

    expect(media.videos).toHaveLength(0);
  });
});
