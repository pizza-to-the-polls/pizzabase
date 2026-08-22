// Mock @bugsnag/js so we never make network calls and can assert config.
jest.mock("@bugsnag/js", () => {
  const expressPlugin = {
    name: "express",
    requestHandler: jest.fn(),
    errorHandler: jest.fn(),
  };
  const mock = {
    start: jest.fn(),
    getPlugin: jest.fn().mockReturnValue({
      requestHandler: jest.fn(),
      errorHandler: jest.fn(),
    }),
  };
  return {
    __esModule: true,
    default: mock,
    BugsnagPluginExpress: expressPlugin,
  };
});

jest.mock("@bugsnag/plugin-express", () => ({
  __esModule: true,
  default: { name: "express" },
}));

describe("initBugSnagMiddleware", () => {
  const originalKey = process.env.BUGSNAG_KEY;

  beforeEach(() => {
    // The module caches middleware state, so re-import per test.
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
  // jest.fn() instances that the freshly-required ./bugsnag module receives.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const loadModule = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bugsnag = require("@bugsnag/js") as any;
    const mod = require("./bugsnag") as typeof import("./bugsnag");
    return { bugsnag: bugsnag.default ?? bugsnag, mod };
  };
  /* eslint-enable @typescript-eslint/no-var-requires */

  it("starts Bugsnag with autoTrackSessions disabled (BUG-006)", () => {
    process.env.BUGSNAG_KEY = "test-api-key";
    const { bugsnag, mod } = loadModule();
    mod.initBugSnagMiddleware();

    expect(bugsnag.start).toHaveBeenCalledTimes(1);
    const config = bugsnag.start.mock.calls[0][0];
    expect(config.apiKey).toBe("test-api-key");
    // BUG-006: Lambda cold-start POSTs to sessions.bugsnag.com fail with TLS
    // resets; sessions aren't meaningful server-side so tracking is disabled.
    expect(config.autoTrackSessions).toBe(false);
  });

  it("registers the express request/error handlers when a key is set", () => {
    process.env.BUGSNAG_KEY = "test-api-key";
    const use = jest.fn();

    const { addBugSnagRequestHandler, addBugSnagErrorHandler } =
      loadModule().mod.initBugSnagMiddleware();
    addBugSnagRequestHandler({ use });
    addBugSnagErrorHandler({ use });

    expect(use).toHaveBeenCalledTimes(2);
  });

  it("does not start Bugsnag or register handlers without a key", () => {
    delete process.env.BUGSNAG_KEY;
    const use = jest.fn();

    const { bugsnag, mod } = loadModule();
    const { addBugSnagRequestHandler, addBugSnagErrorHandler } =
      mod.initBugSnagMiddleware();
    addBugSnagRequestHandler({ use });
    addBugSnagErrorHandler({ use });

    expect(bugsnag.start).not.toHaveBeenCalled();
    expect(use).not.toHaveBeenCalled();
  });
});
