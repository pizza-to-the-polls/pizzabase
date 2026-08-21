import { twitterPost } from "./twitter";
import { Order, OrderTypes } from "../entity/Order";
import { Location } from "../entity/Location";
import { Upload } from "../entity/Upload";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setTwitterEnv() {
  process.env.TWITTER_API_KEY = "test-api-key";
  process.env.TWITTER_API_SECRET = "test-api-secret";
  process.env.TWITTER_ACCESS_TOKEN = "test-access-token";
  process.env.TWITTER_ACCESS_SECRET = "test-access-secret";
  process.env.STATIC_SITE = "https://polls.pizza";
  process.env.UPLOAD_S3_BUCKET = "reports.polls.pizza";
}

function clearTwitterEnv() {
  delete process.env.TWITTER_API_KEY;
  delete process.env.TWITTER_API_SECRET;
  delete process.env.TWITTER_ACCESS_TOKEN;
  delete process.env.TWITTER_ACCESS_SECRET;
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
  }> = {},
): Promise<Order> {
  const {
    quantity = 32,
    orderType = OrderTypes.pizzas,
    cost = 500.23,
    restaurant = null,
    address = "123 Main St",
    city = "Portland",
    state = "OR",
    fullAddress = "123 Main St Portland OR 97201",
  } = overrides;

  const location = await Location.createFromAddress({
    latitude: 45.5152,
    longitude: -122.6784,
    fullAddress,
    address,
    city,
    state,
    zip: "97201",
  });

  return Order.placeOrder({ quantity, orderType, cost, restaurant }, location);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("twitterPost", () => {
  beforeEach(() => {
    setTwitterEnv();
    (global.fetch as jest.Mock).mockReset();
  });

  afterEach(() => {
    clearTwitterEnv();
  });

  it("is a no-op when TWITTER_API_KEY is not set", async () => {
    clearTwitterEnv();
    const order = await createTestOrder();

    await twitterPost(order);

    // fetch should not have been called for Twitter
    const calls = (global.fetch as jest.Mock).mock.calls;
    const twitterCalls = calls.filter(
      ([url]: [string]) =>
        typeof url === "string" &&
        (url.includes("api.twitter.com") || url.includes("upload.twitter.com")),
    );
    expect(twitterCalls).toHaveLength(0);
  });

  it("posts a tweet with order text", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
    });

    const order = await createTestOrder();
    await twitterPost(order);

    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);

    const body = JSON.parse(tweetCalls[0][1].body);
    expect(body.text).toContain("32 pizzas");
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.text.length).toBeLessThanOrEqual(280);

    jest.restoreAllMocks();
  });

  it("includes restaurant when renderable", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
    });

    const order = await createTestOrder({ restaurant: "Pizza Hut" });
    await twitterPost(order);

    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);

    const body = JSON.parse(tweetCalls[0][1].body);
    // The text should not contain leftover placeholders
    expect(body.text).not.toContain("{{");
    expect(body.text.length).toBeGreaterThan(0);

    jest.restoreAllMocks();
  });

  it("includes donut label for donut orders", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
    });

    const order = await createTestOrder({
      orderType: OrderTypes.donuts,
      quantity: 5,
    });
    await twitterPost(order);

    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);

    const body = JSON.parse(tweetCalls[0][1].body);
    expect(body.text).toContain("5 dozen donuts");

    jest.restoreAllMocks();
  });

  it("truncates tweet text that exceeds 280 characters", async () => {
    // Pick a long template (index 3, the cow ASCII art one) and a very long
    // address so the rendered text exceeds 280 characters.
    jest.spyOn(Math, "random").mockReturnValue(3.5 / 35);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
    });

    const longAddress = "A".repeat(400) + " St";
    const order = await createTestOrder({
      address: longAddress,
      fullAddress: longAddress + " Portland OR 97201",
    });
    await twitterPost(order);

    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);

    const body = JSON.parse(tweetCalls[0][1].body);
    // truncateMessage guarantees the literal text is ≤ 280 characters
    expect(body.text.length).toBeLessThanOrEqual(280);
    expect(body.text).toContain("...");

    jest.restoreAllMocks();
  });

  it("handles duplicate tweet (187) gracefully", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          errors: [{ code: 187, message: "Status is a duplicate" }],
        }),
    });

    const order = await createTestOrder();
    // Should not throw
    await expect(twitterPost(order)).resolves.toBeUndefined();
  });

  it("handles rate limiting (429) gracefully", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: () =>
        Promise.resolve({
          errors: [{ code: 429, message: "Rate limit exceeded" }],
        }),
    });

    const order = await createTestOrder();
    await expect(twitterPost(order)).resolves.toBeUndefined();
  });

  it("handles rate limiting (88) gracefully", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: () =>
        Promise.resolve({
          errors: [{ code: 88, message: "Rate limit exceeded" }],
        }),
    });

    const order = await createTestOrder();
    await expect(twitterPost(order)).resolves.toBeUndefined();
  });

  it("handles auth errors (32, 89, 99) gracefully", async () => {
    const authCodes = [32, 89, 99];
    for (let i = 0; i < authCodes.length; i++) {
      const code = authCodes[i];
      (global.fetch as jest.Mock).mockReset();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            errors: [{ code, message: "Could not authenticate you" }],
          }),
      });

      // Use a unique address per iteration to avoid DB unique-constraint
      // violations on the locations table.
      const suffix = `-auth-${i}`;
      const order = await createTestOrder({
        address: `123 Auth${suffix} St`,
        city: `Portland${suffix}`,
        fullAddress: `123 Auth${suffix} St Portland${suffix} OR 97201`,
      });
      await expect(twitterPost(order)).resolves.toBeUndefined();
    }
  });

  it("retries once on 5xx errors", async () => {
    // First call (tweet) fails with 500, second (retry) succeeds
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            errors: [{ message: "Internal server error" }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
      });

    const order = await createTestOrder();
    await twitterPost(order);

    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(2);
  });

  it("retries once on tweet-too-long (186) with truncated text", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            errors: [{ code: 186, message: "Tweet needs to be shorter" }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
      });

    const order = await createTestOrder();
    await twitterPost(order);

    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(2);

    // Second call should have truncated text
    const retryBody = JSON.parse(tweetCalls[1][1].body);
    expect(retryBody.text.length).toBeLessThanOrEqual(280);
    expect(retryBody.text).toContain("...");
  });

  it("does not throw on network errors", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const order = await createTestOrder();
    await expect(twitterPost(order)).resolves.toBeUndefined();
  });

  it("posts a tweet with OAuth 1.0a Authorization header", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
    });

    const order = await createTestOrder();
    await twitterPost(order);

    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);

    const headers = tweetCalls[0][1].headers;
    expect(headers.Authorization).toBeDefined();
    expect(headers.Authorization).toMatch(/^OAuth /);
    expect(headers.Authorization).toContain(
      'oauth_consumer_key="test-api-key"',
    );
    expect(headers.Authorization).toContain(
      'oauth_signature_method="HMAC-SHA1"',
    );
    expect(headers.Authorization).toContain('oauth_version="1.0"');
    expect(headers.Authorization).toContain("oauth_signature=");
  });
});

describe("twitterPost with media", () => {
  beforeEach(async () => {
    setTwitterEnv();
    (global.fetch as jest.Mock).mockReset();
  });

  afterEach(() => {
    clearTwitterEnv();
  });

  it("uploads images and attaches them to the tweet", async () => {
    // Create order with location
    const location = await Location.createFromAddress({
      latitude: 45.5152,
      longitude: -122.6784,
      fullAddress: "456 Oak Ave Portland OR 97201",
      address: "456 Oak Ave",
      city: "Portland",
      state: "OR",
      zip: "97201",
    });

    // Create an upload associated with the location
    const upload = new Upload();
    upload.location = location;
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/portland-or-test.jpg";
    upload.fileHash = "abc123imagehash";
    await upload.save();

    const order = await Order.placeOrder(
      { quantity: 10, orderType: OrderTypes.pizzas, cost: 100 },
      location,
    );

    // Mock S3 download + Twitter media upload + metadata + tweet
    (global.fetch as jest.Mock)
      // S3 download for image
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "image/jpeg"]]),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
      })
      // Twitter media upload
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            media_id_string: "987654321",
          }),
      })
      // Twitter alt text metadata
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      // Twitter tweet post
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
      });

    await twitterPost(order);

    // Verify media upload call
    const mediaCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) =>
        url === "https://upload.twitter.com/1.1/media/upload.json",
    );
    expect(mediaCalls.length).toBeGreaterThanOrEqual(1);

    // Verify alt text call
    const altCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) =>
        url === "https://upload.twitter.com/1.1/media/metadata/create.json",
    );
    expect(altCalls).toHaveLength(1);

    // Verify tweet includes media_ids
    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);
    const body = JSON.parse(tweetCalls[0][1].body);
    expect(body.media.media_ids).toContain("987654321");
  });

  it("uploads videos using chunked upload flow", async () => {
    const location = await Location.createFromAddress({
      latitude: 45.5152,
      longitude: -122.6784,
      fullAddress: "789 Pine Rd Portland OR 97201",
      address: "789 Pine Rd",
      city: "Portland",
      state: "OR",
      zip: "97201",
    });

    const upload = new Upload();
    upload.location = location;
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/portland-or-video.mp4";
    upload.fileHash = "abc456videohash";
    await upload.save();

    const order = await Order.placeOrder(
      { quantity: 5, orderType: OrderTypes.pizzas, cost: 50 },
      location,
    );

    (global.fetch as jest.Mock)
      // S3 download for video
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "video/mp4"]]),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(5000000)),
      })
      // INIT
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            media_id_string: "111111111",
          }),
      })
      // APPEND
      .mockResolvedValueOnce({
        ok: true,
      })
      // FINALIZE
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            processing_info: { state: "succeeded" },
          }),
      })
      // Alt text
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      // Tweet
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
      });

    await twitterPost(order);

    // Check INIT call
    const allCalls = (global.fetch as jest.Mock).mock.calls;
    const initCall = allCalls.find(
      ([_url, opts]: [string, any]) =>
        opts?.body?.includes?.("command=INIT") ||
        (typeof opts?.body === "string" && opts.body.includes("command=INIT")),
    );
    expect(initCall).toBeTruthy();

    // Check APPEND call (Buffer body with multipart video data)
    const uploadCalls = allCalls.filter(
      ([url]: [string]) =>
        url === "https://upload.twitter.com/1.1/media/upload.json",
    );
    // INIT (URLSearchParams) + APPEND (Buffer) + FINALIZE (URLSearchParams) = 3
    expect(uploadCalls.length).toBeGreaterThanOrEqual(3);
    const bufferCalls = uploadCalls.filter(
      ([_url, opts]: [string, any]) => opts?.body instanceof Buffer,
    );
    expect(bufferCalls.length).toBeGreaterThanOrEqual(1);

    // Check FINALIZE call
    const finalizeCall = allCalls.find(
      ([_url, opts]: [string, any]) =>
        typeof opts?.body === "string" &&
        opts.body.includes("command=FINALIZE"),
    );
    expect(finalizeCall).toBeTruthy();

    // Check tweet has media
    const tweetCalls = allCalls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);
    const body = JSON.parse(tweetCalls[0][1].body);
    expect(body.media.media_ids).toContain("111111111");
  });

  it("skips video that exceeds 512 MB with a warning", async () => {
    const location = await Location.createFromAddress({
      latitude: 45.5152,
      longitude: -122.6784,
      fullAddress: "101 Giant Video Portland OR 97201",
      address: "101 Giant Video",
      city: "Portland",
      state: "OR",
      zip: "97201",
    });

    const upload = new Upload();
    upload.location = location;
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/giant-video.mp4";
    upload.fileHash = "bighash123";
    await upload.save();

    const order = await Order.placeOrder(
      { quantity: 1, orderType: OrderTypes.pizzas, cost: 10 },
      location,
    );

    // S3 download returns huge buffer (> 512 MB)
    const hugeBuffer = new ArrayBuffer(513 * 1024 * 1024); // 513 MB
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "video/mp4"]]),
        arrayBuffer: () => Promise.resolve(hugeBuffer),
      })
      // Tweet post (no media, since video was skipped)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
      });

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await twitterPost(order);

    // Should have warned about large video
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("video too large"),
    );

    // Tweet should NOT include media (video was skipped)
    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);
    const body = JSON.parse(tweetCalls[0][1].body);
    expect(body.media).toBeUndefined();

    warnSpy.mockRestore();
  });

  it("skips image that exceeds 5 MB with a warning", async () => {
    const location = await Location.createFromAddress({
      latitude: 45.5152,
      longitude: -122.6784,
      fullAddress: "202 Big Image Portland OR 97201",
      address: "202 Big Image",
      city: "Portland",
      state: "OR",
      zip: "97201",
    });

    const upload = new Upload();
    upload.location = location;
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/big-image.jpg";
    upload.fileHash = "bigimagehash";
    await upload.save();

    const order = await Order.placeOrder(
      { quantity: 2, orderType: OrderTypes.pizzas, cost: 20 },
      location,
    );

    // S3 download returns buffer > 5 MB
    const bigBuffer = new ArrayBuffer(6 * 1024 * 1024); // 6 MB
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "image/jpeg"]]),
        arrayBuffer: () => Promise.resolve(bigBuffer),
      })
      // Tweet post (no media, since image was skipped)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
      });

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await twitterPost(order);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("image too large"),
    );

    // Tweet should NOT include media
    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);
    const body = JSON.parse(tweetCalls[0][1].body);
    expect(body.media).toBeUndefined();

    warnSpy.mockRestore();
  });

  it("continues with tweet even when media upload fails", async () => {
    const location = await Location.createFromAddress({
      latitude: 45.5152,
      longitude: -122.6784,
      fullAddress: "303 Fail Image Portland OR 97201",
      address: "303 Fail Image",
      city: "Portland",
      state: "OR",
      zip: "97201",
    });

    const upload = new Upload();
    upload.location = location;
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/fail-image.jpg";
    upload.fileHash = "failhash";
    await upload.save();

    const order = await Order.placeOrder(
      { quantity: 3, orderType: OrderTypes.pizzas, cost: 30 },
      location,
    );

    (global.fetch as jest.Mock)
      // S3 download succeeds
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "image/jpeg"]]),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
      })
      // Twitter media upload FAILS
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ errors: [{ message: "Server error" }] }),
      })
      // Tweet post succeeds (without media)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
      });

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await twitterPost(order);

    // Should log the media upload failure
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to upload media"),
      expect.anything(),
    );

    // Tweet should still be posted (without media)
    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);
    const body = JSON.parse(tweetCalls[0][1].body);
    expect(body.media).toBeUndefined();

    errorSpy.mockRestore();
  });

  it("polls video processing status when video is pending", async () => {
    const location = await Location.createFromAddress({
      latitude: 45.5152,
      longitude: -122.6784,
      fullAddress: "404 Processing Video Portland OR 97201",
      address: "404 Processing Video",
      city: "Portland",
      state: "OR",
      zip: "97201",
    });

    const upload = new Upload();
    upload.location = location;
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/processing-video.mp4";
    upload.fileHash = "processinghash";
    await upload.save();

    const order = await Order.placeOrder(
      { quantity: 4, orderType: OrderTypes.pizzas, cost: 40 },
      location,
    );

    (global.fetch as jest.Mock)
      // S3 download
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "video/mp4"]]),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000000)),
      })
      // INIT
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            media_id_string: "222222222",
          }),
      })
      // APPEND
      .mockResolvedValueOnce({
        ok: true,
      })
      // FINALIZE — processing pending
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            processing_info: {
              state: "pending",
              check_after_secs: 0,
            },
          }),
      })
      // STATUS (poll 1) — still pending
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            processing_info: {
              state: "pending",
              check_after_secs: 0,
            },
          }),
      })
      // STATUS (poll 2) — succeeded
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            processing_info: { state: "succeeded" },
          }),
      })
      // Alt text
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      // Tweet
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
      });

    await twitterPost(order);

    // Count STATUS calls
    const statusCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) =>
        typeof url === "string" &&
        url.includes("command=STATUS") &&
        url.includes("222222222"),
    );
    expect(statusCalls).toHaveLength(2);

    // Tweet should have the media
    const tweetCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url === "https://api.twitter.com/2/tweets",
    );
    expect(tweetCalls).toHaveLength(1);
    const body = JSON.parse(tweetCalls[0][1].body);
    expect(body.media.media_ids).toContain("222222222");
  });

  it("sets alt text after image upload", async () => {
    const location = await Location.createFromAddress({
      latitude: 45.5152,
      longitude: -122.6784,
      fullAddress: "505 Alt Text Portland OR 97201",
      address: "505 Alt Text",
      city: "Portland",
      state: "OR",
      zip: "97201",
    });

    const upload = new Upload();
    upload.location = location;
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/alt-text-test.jpg";
    upload.fileHash = "alttexthash";
    await upload.save();

    const order = await Order.placeOrder(
      { quantity: 7, orderType: OrderTypes.pizzas, cost: 70 },
      location,
    );

    (global.fetch as jest.Mock)
      // S3 download
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([["content-type", "image/jpeg"]]),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(2000)),
      })
      // Twitter media upload
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ media_id_string: "333333333" }),
      })
      // Alt text metadata
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      // Tweet
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "123", text: "..." } }),
      });

    await twitterPost(order);

    // Verify alt text was set
    const altCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]: [string]) =>
        url === "https://upload.twitter.com/1.1/media/metadata/create.json",
    );
    expect(altCall).toBeTruthy();
    const altBody = JSON.parse(altCall[1].body);
    expect(altBody.media_id).toBe("333333333");
    expect(altBody.alt_text.text).toContain("505 Alt Text");
  });
});
