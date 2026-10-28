import { socialPost } from "./social";
import { blueskyPost } from "./bluesky";
import { twitterPost } from "./twitter";
import { threadsPost } from "./threads";

jest.mock("./bluesky", () => ({
  blueskyPost: jest.fn(),
}));

jest.mock("./twitter", () => ({
  twitterPost: jest.fn(),
}));

jest.mock("./threads", () => ({
  threadsPost: jest.fn(),
}));

jest.mock("./message-templates", () => ({
  renderMessage: jest.fn().mockReturnValue("Shared post text"),
}));

jest.mock("./media", () => ({
  collectMedia: jest.fn().mockResolvedValue({
    images: ["https://polls.pizza/uploads/test.jpg"],
    videos: [],
    alt: "Long line at 123 Main St",
  }),
}));

import { renderMessage } from "./message-templates";
import { collectMedia } from "./media";

describe("socialPost", () => {
  const mockOrder = { id: 123, location: { address: "123 Main St" } } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls renderMessage once with the order", async () => {
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    expect(renderMessage).toHaveBeenCalledTimes(1);
    expect(renderMessage).toHaveBeenCalledWith(mockOrder);
  });

  it("calls collectMedia once with the order", async () => {
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    expect(collectMedia).toHaveBeenCalledTimes(1);
    expect(collectMedia).toHaveBeenCalledWith(mockOrder);
  });

  it("calls blueskyPost, twitterPost, and threadsPost with shared text and media", async () => {
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    const expectedMedia = {
      images: ["https://polls.pizza/uploads/test.jpg"],
      videos: [],
      alt: "Long line at 123 Main St",
    };

    expect(blueskyPost).toHaveBeenCalledWith(
      mockOrder,
      "Shared post text",
      expectedMedia,
    );
    expect(twitterPost).toHaveBeenCalledWith(
      mockOrder,
      "Shared post text",
      expectedMedia,
    );
    expect(threadsPost).toHaveBeenCalledWith(
      mockOrder,
      "Shared post text",
      expectedMedia,
    );
  });

  it("does not throw when collectMedia rejects", async () => {
    (collectMedia as jest.Mock).mockRejectedValue(new Error("Media error"));
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    // Should still call platform posts with default empty media
    expect(blueskyPost).toHaveBeenCalledWith(mockOrder, "Shared post text", {
      images: [],
      videos: [],
      alt: "",
    });
    expect(twitterPost).toHaveBeenCalledWith(mockOrder, "Shared post text", {
      images: [],
      videos: [],
      alt: "",
    });
    expect(threadsPost).toHaveBeenCalledWith(mockOrder, "Shared post text", {
      images: [],
      videos: [],
      alt: "",
    });
  });

  it("does not throw when blueskyPost rejects", async () => {
    (blueskyPost as jest.Mock).mockRejectedValue(new Error("BlueSky down"));
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    // Should not throw — fire-and-forget semantics
  });

  it("does not throw when twitterPost rejects", async () => {
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockRejectedValue(new Error("Twitter down"));
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    // Should not throw — fire-and-forget semantics
  });

  it("does not throw when threadsPost rejects", async () => {
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockRejectedValue(new Error("Threads down"));

    await socialPost(mockOrder);

    // Should not throw — fire-and-forget semantics
  });

  it("does not call bluesky or twitter when they are not configured", async () => {
    const origBlueskyHandle = process.env.BSKY_HANDLE;
    const origBlueskyPassword = process.env.BSKY_APP_PASSWORD;
    const origTwitterKey = process.env.TWITTER_API_KEY;

    delete process.env.BSKY_HANDLE;
    delete process.env.BSKY_APP_PASSWORD;
    delete process.env.TWITTER_API_KEY;

    try {
      await socialPost(mockOrder);

      expect(blueskyPost).not.toHaveBeenCalled();
      expect(twitterPost).not.toHaveBeenCalled();
      // Threads is called unconditionally — it self-gates on its DB-stored
      // token at runtime (#199), which env vars cannot reflect here.
      expect(threadsPost).toHaveBeenCalled();
    } finally {
      if (origBlueskyHandle === undefined) {
        delete process.env.BSKY_HANDLE;
      } else {
        process.env.BSKY_HANDLE = origBlueskyHandle;
      }
      if (origBlueskyPassword === undefined) {
        delete process.env.BSKY_APP_PASSWORD;
      } else {
        process.env.BSKY_APP_PASSWORD = origBlueskyPassword;
      }
      if (origTwitterKey === undefined) {
        delete process.env.TWITTER_API_KEY;
      } else {
        process.env.TWITTER_API_KEY = origTwitterKey;
      }
    }
  });

  it("does not throw when all three reject", async () => {
    (blueskyPost as jest.Mock).mockRejectedValue(new Error("BlueSky down"));
    (twitterPost as jest.Mock).mockRejectedValue(new Error("Twitter down"));
    (threadsPost as jest.Mock).mockRejectedValue(new Error("Threads down"));

    await socialPost(mockOrder);

    // Should not throw — fire-and-forget semantics
  });

  it("logs errors when blueskyPost rejects", async () => {
    const error = new Error("BlueSky error");
    (blueskyPost as jest.Mock).mockRejectedValue(error);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    // Wait for microtask to flush the .catch handler
    await new Promise(setImmediate);

    expect(console.error).toHaveBeenCalledWith(
      "socialPost: bluesky → FAILED (Error: BlueSky error)",
    );
  });

  it("logs errors when twitterPost rejects", async () => {
    const error = new Error("Twitter error");
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockRejectedValue(error);
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    await new Promise(setImmediate);

    expect(console.error).toHaveBeenCalledWith(
      "socialPost: twitter → FAILED (Error: Twitter error)",
    );
  });

  it("logs errors when threadsPost rejects", async () => {
    const error = new Error("Threads error");
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockRejectedValue(error);

    await socialPost(mockOrder);

    await new Promise(setImmediate);

    expect(console.error).toHaveBeenCalledWith(
      "socialPost: threads → FAILED (Error: Threads error)",
    );
  });
});

describe("socialPost with Slack target (#213 staging shim)", () => {
  const mockOrder = { id: 123, location: { address: "123 Main St" } } as any;
  const WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XYZ";

  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    // Re-establish the module-level mock implementations: jest.clearAllMocks()
    // clears call history but not implementations, and the error-path tests in
    // the describe above leave a persistent mockRejectedValue on collectMedia
    // (and platform posts) that would otherwise leak into this block.
    (renderMessage as jest.Mock).mockReturnValue("Shared post text");
    (collectMedia as jest.Mock).mockResolvedValue({
      images: ["https://polls.pizza/uploads/test.jpg"],
      videos: [],
      alt: "Long line at 123 Main St",
    });
    envBackup.SOCIAL_POST_TARGET = process.env.SOCIAL_POST_TARGET;
    envBackup.SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (envBackup.SOCIAL_POST_TARGET === undefined) {
      delete process.env.SOCIAL_POST_TARGET;
    } else {
      process.env.SOCIAL_POST_TARGET = envBackup.SOCIAL_POST_TARGET;
    }
    if (envBackup.SLACK_WEBHOOK_URL === undefined) {
      delete process.env.SLACK_WEBHOOK_URL;
    } else {
      process.env.SLACK_WEBHOOK_URL = envBackup.SLACK_WEBHOOK_URL;
    }
  });

  /** Configure the slack target for a test. */
  function setSlackTarget(webhookUrl: string | null) {
    process.env.SOCIAL_POST_TARGET = "slack";
    if (webhookUrl === null) {
      delete process.env.SLACK_WEBHOOK_URL;
    } else {
      process.env.SLACK_WEBHOOK_URL = webhookUrl;
    }
  }

  it("posts the preview to the Slack webhook and does not call platform modules", async () => {
    setSlackTarget(WEBHOOK_URL);

    await socialPost(mockOrder);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.text).toContain("🍕 *Social post preview* (staging)");
    expect(body.text).toContain("Shared post text");

    // Zero calls to the live platform modules
    expect(blueskyPost).not.toHaveBeenCalled();
    expect(twitterPost).not.toHaveBeenCalled();
    expect(threadsPost).not.toHaveBeenCalled();
  });

  it("includes media URLs and the would-be platform list in the Slack message", async () => {
    setSlackTarget(WEBHOOK_URL);

    await socialPost(mockOrder);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.text).toContain(
      "*Images:* https://polls.pizza/uploads/test.jpg",
    );
    // No videos in the mocked collectMedia result — no Videos line
    expect(body.text).not.toContain("*Videos:*");
    expect(body.text).toContain("*Would post to:* BlueSky, Twitter, Threads");
  });

  it("includes a Videos line when collectMedia returns videos", async () => {
    setSlackTarget(WEBHOOK_URL);
    (collectMedia as jest.Mock).mockResolvedValueOnce({
      images: ["https://polls.pizza/uploads/test.jpg"],
      videos: ["https://polls.pizza/uploads/test.mp4"],
      alt: "Long line at 123 Main St",
    });

    await socialPost(mockOrder);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.text).toContain(
      "*Videos:* https://polls.pizza/uploads/test.mp4",
    );
  });

  it("falls through to live behavior when SOCIAL_POST_TARGET is live", async () => {
    process.env.SOCIAL_POST_TARGET = "live";
    process.env.SLACK_WEBHOOK_URL = WEBHOOK_URL;
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    expect(blueskyPost).toHaveBeenCalledWith(mockOrder, "Shared post text", {
      images: ["https://polls.pizza/uploads/test.jpg"],
      videos: [],
      alt: "Long line at 123 Main St",
    });
    expect(twitterPost).toHaveBeenCalled();
    expect(threadsPost).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls through to live behavior when SOCIAL_POST_TARGET is unset", async () => {
    delete process.env.SOCIAL_POST_TARGET;
    delete process.env.SLACK_WEBHOOK_URL;
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    expect(blueskyPost).toHaveBeenCalled();
    expect(twitterPost).toHaveBeenCalled();
    expect(threadsPost).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("still posts to platforms for unknown target values (live fallback)", async () => {
    process.env.SOCIAL_POST_TARGET = "slak"; // typo → live behavior
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    expect(blueskyPost).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("logs an error and skips platforms when SLACK_WEBHOOK_URL is not set", async () => {
    setSlackTarget(null);

    await socialPost(mockOrder);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "socialPost: slack → SLACK_WEBHOOK_URL is not set; skipping Slack preview",
    );
    expect(blueskyPost).not.toHaveBeenCalled();
    expect(twitterPost).not.toHaveBeenCalled();
    expect(threadsPost).not.toHaveBeenCalled();
  });

  it("does not throw and logs when the Slack webhook request fails", async () => {
    setSlackTarget(WEBHOOK_URL);
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network down"));

    await expect(socialPost(mockOrder)).resolves.toBeUndefined();

    await new Promise(setImmediate);
    expect(console.error).toHaveBeenCalledWith(
      "socialPost: slack → FAILED (Error: network down)",
    );
  });

  it("does not throw when the Slack webhook returns a non-OK response", async () => {
    setSlackTarget(WEBHOOK_URL);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(socialPost(mockOrder)).resolves.toBeUndefined();

    await new Promise(setImmediate);
    expect(console.error).toHaveBeenCalledWith(
      "socialPost: slack → FAILED (500 Internal Server Error)",
    );
  });

  it("still posts to Slack with empty media when collectMedia rejects in slack mode", async () => {
    setSlackTarget(WEBHOOK_URL);
    (collectMedia as jest.Mock).mockRejectedValueOnce(new Error("Media error"));

    await socialPost(mockOrder);

    // Slack still gets the preview, with empty media
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.text).toContain("Shared post text");
    expect(body.text).not.toContain("*Images:*");
    expect(blueskyPost).not.toHaveBeenCalled();
  });
});
