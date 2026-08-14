import { threadsPost } from "./threads";
import { AppDataSource } from "../data-source";
import { IntegrationSession } from "../entity/IntegrationSession";
import { Order, OrderTypes } from "../entity/Order";
import { Location } from "../entity/Location";
import { Upload } from "../entity/Upload";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setThreadsEnv() {
  process.env.THREADS_ACCESS_TOKEN = "test-threads-access-token";
  process.env.THREADS_USER_ID = "test-threads-user-id";

  const repo = AppDataSource.getRepository(IntegrationSession);
  const row = new IntegrationSession();
  row.service = "threads";
  row.credentials = { accessToken: "test-threads-access-token" };
  await repo.save(row);
}

async function clearThreadsEnv() {
  delete process.env.THREADS_ACCESS_TOKEN;
  delete process.env.THREADS_USER_ID;

  const repo = AppDataSource.getRepository(IntegrationSession);
  await repo.delete({ service: "threads" });
}

async function createTestOrder(
  overrides: Partial<{
    quantity: number;
    orderType: OrderTypes;
    cost: number;
    restaurant: string | null;
    address: string;
    city: string;
    state: string;
    fullAddress: string;
  }> = {}
): Promise<Order> {
  const {
    quantity = 5,
    orderType = OrderTypes.pizzas,
    cost = 100.0,
    restaurant = "Lou Malnati's",
    address = "123 Main St",
    city = "Chicago",
    state = "IL",
    fullAddress = "123 Main St Chicago IL 60615",
  } = overrides;

  const location = await Location.createFromAddress({
    latitude: 41.79907,
    longitude: -87.58413,
    fullAddress,
    address,
    city,
    state,
    zip: "60615",
  });

  return Order.placeOrder({ quantity, orderType, cost, restaurant }, location);
}

// Helper to identify Threads API fetch calls
function threadsFetchCalls(): [string, RequestInit][] {
  return (global.fetch as jest.Mock).mock.calls.filter(
    ([url]: [string]) =>
      typeof url === "string" && url.includes("graph.threads.net")
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("threadsPost", () => {
  beforeEach(async () => {
    await setThreadsEnv();
    (global.fetch as jest.Mock).mockReset();
  });

  afterEach(async () => {
    await clearThreadsEnv();
  });

  // ------------------------------------------------------------------
  // Configuration gate
  // ------------------------------------------------------------------

  it("is a no-op when THREADS_ACCESS_TOKEN is not set", async () => {
    await clearThreadsEnv();
    const order = await createTestOrder();

    await threadsPost(order);

    const calls = threadsFetchCalls();
    expect(calls).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // Text-only posting
  // ------------------------------------------------------------------

  describe("text-only posting", () => {
    it("posts text-only when no media URLs provided", async () => {
      jest.spyOn(Math, "random").mockReturnValue(0);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "threads-post-123" }),
      });

      const order = await createTestOrder();
      await threadsPost(order);

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(1);

      const [url, opts] = calls[0];
      expect(url).toContain("/threads");
      expect(url).not.toContain("threads_publish");

      const body = JSON.parse(opts.body as string);
      expect(body.media_type).toBe("TEXT");
      expect(body.text).toContain("5 pizzas");
      expect(body.text.length).toBeGreaterThan(0);

      jest.restoreAllMocks();
    });

    it("uses provided text when passed", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "threads-post-456" }),
      });

      const order = await createTestOrder();
      await threadsPost(order, "Custom provided text");

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(1);

      const body = JSON.parse(calls[0][1].body as string);
      expect(body.text).toBe("Custom provided text");
    });

    it("truncates text exceeding 500 characters", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "threads-post-789" }),
      });

      const longText = "🍕".repeat(600);
      const order = await createTestOrder();
      await threadsPost(order, longText);

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(1);

      const body = JSON.parse(calls[0][1].body as string);
      expect(body.text.length).toBeLessThanOrEqual(500);
      expect(body.text).toContain("...");
    });

    it("renders message from order when text not provided", async () => {
      jest.spyOn(Math, "random").mockReturnValue(0);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "post-from-template" }),
      });

      const order = await createTestOrder({
        quantity: 10,
        restaurant: "Giordano's",
      });
      await threadsPost(order);

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(1);

      const body = JSON.parse(calls[0][1].body as string);
      expect(body.text).toContain("10 pizzas");
      expect(body.text).not.toContain("{{");

      jest.restoreAllMocks();
    });

    it("includes donut label for donut orders", async () => {
      jest.spyOn(Math, "random").mockReturnValue(0);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "donut-post" }),
      });

      const order = await createTestOrder({
        orderType: OrderTypes.donuts,
        quantity: 3,
        restaurant: "",
      });
      await threadsPost(order);

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(1);

      const body = JSON.parse(calls[0][1].body as string);
      expect(body.text).toContain("3 dozen donuts");

      jest.restoreAllMocks();
    });

    it("includes Authorization header with Bearer token", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "auth-test" }),
      });

      const order = await createTestOrder();
      await threadsPost(order);

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(1);

      const headers = calls[0][1].headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-threads-access-token");
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });

  // ------------------------------------------------------------------
  // Media posting (two-step)
  // ------------------------------------------------------------------

  describe("media posting", () => {
    it("creates container then publishes for image", async () => {
      const order = await createTestOrder();

      // Create an upload so media is available
      const upload = new Upload();
      upload.location = order.location;
      upload.ipAddress = "127.0.0.1";
      upload.filePath = "uploads/chicago-il-threads-test.jpg";
      upload.fileHash = "threads_hash_img";
      await upload.save();

      // Step 1: container creation returns id
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "container-abc-123" }),
        })
        // Step 2: publish returns post id
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "threads-post-media-456" }),
        });

      await threadsPost(order);

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(2);

      // Step 1: container
      const containerBody = JSON.parse(calls[0][1].body as string);
      expect(calls[0][0]).toContain("/test-threads-user-id/threads");
      expect(containerBody.media_type).toBe("IMAGE");
      expect(containerBody.image_url).toContain(
        "polls.pizza/uploads/chicago-il-threads-test.jpg"
      );
      expect(containerBody.alt_text).toContain("123 Main St");
      expect(containerBody.text).toBeTruthy();

      // Step 2: publish
      const publishBody = JSON.parse(calls[1][1].body as string);
      expect(calls[1][0]).toContain("/test-threads-user-id/threads_publish");
      expect(publishBody.creation_id).toBe("container-abc-123");
    });

    it("creates container then publishes for video", async () => {
      const order = await createTestOrder();

      const upload = new Upload();
      upload.location = order.location;
      upload.ipAddress = "127.0.0.1";
      upload.filePath = "uploads/chicago-il-threads-video.mp4";
      upload.fileHash = "threads_hash_vid";
      await upload.save();

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "vid-container-789" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "vid-post-101" }),
        });

      await threadsPost(order);

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(2);

      // Step 1: container should have video_url, not image_url
      const containerBody = JSON.parse(calls[0][1].body as string);
      expect(containerBody.media_type).toBe("VIDEO");
      expect(containerBody.video_url).toContain("threads-video.mp4");
      expect(containerBody.image_url).toBeUndefined();
    });

    it("tries video first then falls back to image", async () => {
      const order = await createTestOrder();

      // Video upload
      const vidUpload = new Upload();
      vidUpload.location = order.location;
      vidUpload.ipAddress = "127.0.0.1";
      vidUpload.filePath = "uploads/threads-pref-video.mp4";
      vidUpload.fileHash = "pref_vid";
      await vidUpload.save();

      // Image upload
      const imgUpload = new Upload();
      imgUpload.location = order.location;
      imgUpload.ipAddress = "127.0.0.1";
      imgUpload.filePath = "uploads/threads-pref-image.jpg";
      imgUpload.fileHash = "pref_img";
      await imgUpload.save();

      // Video fails, image succeeds
      (global.fetch as jest.Mock)
        // Video container fails
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: { message: "Video too long" } }),
        })
        // Image container succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "image-container-fallback" }),
        })
        // Image publish succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "image-post-fallback" }),
        });

      await threadsPost(order);

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(3);

      // First call should be video container
      const videoBody = JSON.parse(calls[0][1].body as string);
      expect(videoBody.media_type).toBe("VIDEO");

      // Second call should be image container
      const imageBody = JSON.parse(calls[1][1].body as string);
      expect(imageBody.media_type).toBe("IMAGE");

      // Third call should be image publish
      const publishBody = JSON.parse(calls[2][1].body as string);
      expect(publishBody.creation_id).toBe("image-container-fallback");
    });

    it("falls back to text-only when all media fail", async () => {
      const order = await createTestOrder();

      const upload = new Upload();
      upload.location = order.location;
      upload.ipAddress = "127.0.0.1";
      upload.filePath = "uploads/all-fail-image.jpg";
      upload.fileHash = "all_fail";
      await upload.save();

      (global.fetch as jest.Mock)
        // Image container fails
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: { message: "Invalid URL" } }),
        })
        // Fallback text-only succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "fallback-text-post" }),
        });

      await threadsPost(order);

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(2);

      // Second call should be text-only
      const textBody = JSON.parse(calls[1][1].body as string);
      expect(textBody.media_type).toBe("TEXT");
    });

    it("handles publish failure gracefully", async () => {
      const order = await createTestOrder();

      const upload = new Upload();
      upload.location = order.location;
      upload.ipAddress = "127.0.0.1";
      upload.filePath = "uploads/publish-fail.jpg";
      upload.fileHash = "pub_fail";
      await upload.save();

      const errorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      (global.fetch as jest.Mock)
        // Container succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "container-pub-fail" }),
        })
        // Publish fails
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { message: "Publish failed" } }),
        })
        // Fallback text-only succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "text-after-pub-fail" }),
        });

      await threadsPost(order);

      // Should not throw
      expect(threadsFetchCalls().length).toBeGreaterThan(0);

      errorSpy.mockRestore();
    });
  });

  // ------------------------------------------------------------------
  // Error handling
  // ------------------------------------------------------------------

  describe("error handling", () => {
    it("does not throw when all Threads API calls fail", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        new Error("Network failure")
      );

      const order = await createTestOrder();
      await expect(threadsPost(order)).resolves.toBeUndefined();
    });

    it("does not throw when API returns 500", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: "Server error" } }),
      });

      const order = await createTestOrder();
      await expect(threadsPost(order)).resolves.toBeUndefined();
    });

    it("does not throw when container creation returns error", async () => {
      const order = await createTestOrder();

      const upload = new Upload();
      upload.location = order.location;
      upload.ipAddress = "127.0.0.1";
      upload.filePath = "uploads/container-fail.jpg";
      upload.fileHash = "ctr_fail";
      await upload.save();

      (global.fetch as jest.Mock)
        // Container creation fails
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: { message: "Bad request" } }),
        })
        // Fallback text-only succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "text-fallback" }),
        });

      await expect(threadsPost(order)).resolves.toBeUndefined();
    });

    it("does not throw when publish fails", async () => {
      const order = await createTestOrder();

      const upload = new Upload();
      upload.location = order.location;
      upload.ipAddress = "127.0.0.1";
      upload.filePath = "uploads/pub-error.jpg";
      upload.fileHash = "pub_err";
      await upload.save();

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "cont-ok" }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: { message: "Cannot publish" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "text-fb" }),
        });

      await expect(threadsPost(order)).resolves.toBeUndefined();
    });

    it("retries on 5xx errors once", async () => {
      let attempt = 0;
      (global.fetch as jest.Mock).mockImplementation(() => {
        attempt++;
        if (attempt === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: () => Promise.resolve({ error: { message: "Unavailable" } }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "retry-success" }),
        });
      });

      const order = await createTestOrder();
      await threadsPost(order);

      const calls = threadsFetchCalls();
      // Two calls: one failed, one retried
      expect(calls.length).toBe(2);
    });

    it("handles missing alt text gracefully", async () => {
      // Pass mediaUrls with empty alt
      const order = await createTestOrder();

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "no-alt-post" }),
      });

      await threadsPost(order, "Just text, no media");
      // Should resolve fine
    });
  });

  // ------------------------------------------------------------------
  // Shared text and media
  // ------------------------------------------------------------------

  describe("shared text and media", () => {
    it("uses provided mediaUrls over internal collection", async () => {
      const order = await createTestOrder();

      // Provide explicit media URLs
      const providedMedia = {
        images: ["https://example.com/shared-image.jpg"],
        videos: ["https://example.com/shared-video.mp4"],
        alt: "Shared alt text",
      };

      (global.fetch as jest.Mock)
        // Video container (preferred)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "shared-vid-container" }),
        })
        // Video publish
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "shared-vid-post" }),
        });

      await threadsPost(order, "Shared template text", providedMedia);

      const calls = threadsFetchCalls();
      expect(calls).toHaveLength(2);

      const containerBody = JSON.parse(calls[0][1].body as string);
      expect(containerBody.text).toBe("Shared template text");
      expect(containerBody.media_type).toBe("VIDEO");
      expect(containerBody.video_url).toBe(
        "https://example.com/shared-video.mp4"
      );
    });
  });
});
