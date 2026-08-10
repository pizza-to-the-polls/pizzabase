import { socialPost } from "./social";
import { blueskyPost } from "./bluesky";
import { twitterPost } from "./twitter";

jest.mock("./bluesky", () => ({
  blueskyPost: jest.fn(),
}));

jest.mock("./twitter", () => ({
  twitterPost: jest.fn(),
}));

describe("socialPost", () => {
  const mockOrder = { id: 123 } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls both blueskyPost and twitterPost with the order", () => {
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);

    socialPost(mockOrder);

    expect(blueskyPost).toHaveBeenCalledWith(mockOrder);
    expect(twitterPost).toHaveBeenCalledWith(mockOrder);
  });

  it("does not throw when blueskyPost rejects", () => {
    (blueskyPost as jest.Mock).mockRejectedValue(new Error("BlueSky down"));
    (twitterPost as jest.Mock).mockResolvedValue(undefined);

    expect(() => socialPost(mockOrder)).not.toThrow();
  });

  it("does not throw when twitterPost rejects", () => {
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockRejectedValue(new Error("Twitter down"));

    expect(() => socialPost(mockOrder)).not.toThrow();
  });

  it("does not throw when both reject", () => {
    (blueskyPost as jest.Mock).mockRejectedValue(new Error("BlueSky down"));
    (twitterPost as jest.Mock).mockRejectedValue(new Error("Twitter down"));

    expect(() => socialPost(mockOrder)).not.toThrow();
  });

  it("logs errors when blueskyPost rejects", async () => {
    const error = new Error("BlueSky error");
    (blueskyPost as jest.Mock).mockRejectedValue(error);
    (twitterPost as jest.Mock).mockResolvedValue(undefined);

    socialPost(mockOrder);

    // Wait for microtask to flush the .catch handler
    await new Promise(setImmediate);

    expect(console.error).toHaveBeenCalledWith("BlueSky post failed:", error);
  });

  it("logs errors when twitterPost rejects", async () => {
    const error = new Error("Twitter error");
    (blueskyPost as jest.Mock).mockResolvedValue(undefined);
    (twitterPost as jest.Mock).mockRejectedValue(error);

    socialPost(mockOrder);

    await new Promise(setImmediate);

    expect(console.error).toHaveBeenCalledWith("Twitter post failed:", error);
  });
});
