import { collectMedia } from "./media";
import { Order, OrderTypes } from "../entity/Order";
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
): Promise<void> {
  const upload = new Upload();
  upload.location = order.location;
  upload.ipAddress = "127.0.0.1";
  upload.filePath = filePath;
  upload.fileHash = `hash-${filePath}`;
  await upload.save();
  if (ageMinutes > 0) {
    await AppDataSource.getRepository(Upload).update(
      { id: upload.id },
      { createdAt: new Date(Date.now() - ageMinutes * 60 * 1000) as never },
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectMedia", () => {
  it("includes uploads attached to the location", async () => {
    const order = await createTestOrder();
    await addUpload(order, "uploads/line.jpg", 5);

    const media = await collectMedia(order);

    expect(media.images).toHaveLength(1);
    expect(media.images[0]).toContain("line.jpg");
  });

  it("sorts uploads newest first", async () => {
    const order = await createTestOrder();
    await addUpload(order, "uploads/older.jpg", 50);
    await addUpload(order, "uploads/newer.jpg", 40);

    const media = await collectMedia(order);

    expect(media.images).toHaveLength(2);
    expect(media.images[0]).toContain("newer.jpg");
    expect(media.images[1]).toContain("older.jpg");
  });

  it("caps images at four and videos at one", async () => {
    const order = await createTestOrder();
    await addUpload(order, "uploads/p1.jpg", 50);
    await addUpload(order, "uploads/p2.jpg", 49);
    await addUpload(order, "uploads/p3.jpg", 48);
    await addUpload(order, "uploads/p4.jpg", 47);
    await addUpload(order, "uploads/p5.jpg", 46);
    await addUpload(order, "uploads/v1.mp4", 45);
    await addUpload(order, "uploads/v2.mp4", 44);

    const media = await collectMedia(order);

    expect(media.images).toHaveLength(4);
    expect(media.videos).toHaveLength(1);
  });
});
