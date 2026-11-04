// Mock @bugsnag/js so we never make network calls and can assert start/notify.
jest.mock("@bugsnag/js", () => ({
  __esModule: true,
  default: {
    start: jest.fn(),
    notify: jest.fn(),
  },
}));

describe("notifyBugsnag", () => {
  const originalKey = process.env.BUGSNAG_KEY;

  beforeEach(() => {
    // The module caches its `started` flag, so re-import per test.
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.BUGSNAG_KEY;
    } else {
      process.env.BUGSNAG_KEY = originalKey;
    }
  });

  // Resolve the mock AFTER jest.resetModules() so tests observe the same
  // jest.fn() instances that the freshly-required ./notifyBugsnag receives.
  const loadModule = () => {
    const bugsnag = require("@bugsnag/js") as any;
    const mod = require("./notifyBugsnag") as typeof import("./notifyBugsnag");
    return { bugsnag: bugsnag.default ?? bugsnag, mod };
  };

  it("starts Bugsnag on first notify when BUGSNAG_KEY is set (BUG-043)", () => {
    process.env.BUGSNAG_KEY = "test-api-key";
    const { bugsnag, mod } = loadModule();
    const err = new Error("compileClips ENOSPC");

    mod.notifyBugsnag(err);

    expect(bugsnag.start).toHaveBeenCalledTimes(1);
    expect(bugsnag.start).toHaveBeenCalledWith({
      apiKey: "test-api-key",
      autoTrackSessions: false,
    });
    expect(bugsnag.notify).toHaveBeenCalledTimes(1);
    expect(bugsnag.notify).toHaveBeenCalledWith(err);
  });

  it("disables auto session tracking on the lazy start (BUG-006 guard)", () => {
    process.env.BUGSNAG_KEY = "test-api-key";
    const { bugsnag, mod } = loadModule();

    mod.notifyBugsnag(new Error("boom"));

    const config = bugsnag.start.mock.calls[0][0];
    // Cold-start POSTs to sessions.bugsnag.com fail with TLS resets in Lambda.
    expect(config.autoTrackSessions).toBe(false);
  });

  it("starts the client at most once across multiple notifies", () => {
    process.env.BUGSNAG_KEY = "test-api-key";
    const { bugsnag, mod } = loadModule();

    mod.notifyBugsnag(new Error("first"));
    mod.notifyBugsnag(new Error("second"));
    mod.notifyBugsnag(new Error("third"));

    expect(bugsnag.start).toHaveBeenCalledTimes(1);
    expect(bugsnag.notify).toHaveBeenCalledTimes(3);
  });

  it("no-ops silently when BUGSNAG_KEY is not set", () => {
    delete process.env.BUGSNAG_KEY;
    const { bugsnag, mod } = loadModule();

    expect(() => mod.notifyBugsnag(new Error("boom"))).not.toThrow();

    expect(bugsnag.start).not.toHaveBeenCalled();
    expect(bugsnag.notify).not.toHaveBeenCalled();
  });

  it("never throws when Bugsnag.notify throws", () => {
    process.env.BUGSNAG_KEY = "test-api-key";
    const { bugsnag, mod } = loadModule();
    bugsnag.notify.mockImplementation(() => {
      throw new Error("sdk exploded");
    });

    expect(() => mod.notifyBugsnag(new Error("first"))).not.toThrow();

    // Subsequent notifies also survive (and the client isn't restarted).
    expect(() => mod.notifyBugsnag(new Error("second"))).not.toThrow();
    expect(bugsnag.start).toHaveBeenCalledTimes(1);
  });

  it("never throws when Bugsnag.start throws", () => {
    process.env.BUGSNAG_KEY = "test-api-key";
    const { bugsnag, mod } = loadModule();
    bugsnag.start.mockImplementation(() => {
      throw new Error("misconfigured");
    });

    expect(() => mod.notifyBugsnag(new Error("boom"))).not.toThrow();

    expect(bugsnag.notify).not.toHaveBeenCalled();
  });
});
