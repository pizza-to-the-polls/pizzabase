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
      expectedMedia
    );
    expect(twitterPost).toHaveBeenCalledWith(
      mockOrder,
      "Shared post text",
      expectedMedia
    );
    expect(threadsPost).toHaveBeenCalledWith(
      mockOrder,
      "Shared post text",
      expectedMedia
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

    expect(console.error).toHaveBeenCalledWith("BlueSky post failed:", error);
  });

  it("logs errors when twitterPost rejects", async () => {
    const error = new Error("Twitter error");
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockRejectedValue(error);
    (threadsPost as jest.Mock).mockResolvedValue(undefined);

    await socialPost(mockOrder);

    await new Promise(setImmediate);

    expect(console.error).toHaveBeenCalledWith("Twitter post failed:", error);
  });

  it("logs errors when threadsPost rejects", async () => {
    const error = new Error("Threads error");
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);
    (threadsPost as jest.Mock).mockRejectedValue(error);

    await socialPost(mockOrder);

    await new Promise(setImmediate);

    expect(console.error).toHaveBeenCalledWith("Threads post failed:", error);
  });
});
