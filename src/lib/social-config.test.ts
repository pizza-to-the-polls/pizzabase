import { socialEnabled } from "./social-config";

/**
 * Run `fn` with the given env vars set/cleared, then restore the original
 * values. Values of `undefined` delete the variable.
 */
function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
): void {
  const saved = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    saved.set(key, process.env[key]);
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("socialEnabled", () => {
  it("reports blueSky enabled only when both handle and app password are set", () => {
    withEnv(
      {
        BSKY_HANDLE: undefined,
        BSKY_APP_PASSWORD: undefined,
        TWITTER_API_KEY: undefined,
        THREADS_ACCESS_TOKEN: undefined,
      },
      () => {
        expect(socialEnabled().bluesky).toBe(false);

        withEnv({ BSKY_HANDLE: "handle.bsky.social" }, () => {
          expect(socialEnabled().bluesky).toBe(false);
        });

        withEnv({ BSKY_APP_PASSWORD: "app-password" }, () => {
          expect(socialEnabled().bluesky).toBe(false);
        });

        withEnv(
          {
            BSKY_HANDLE: "handle.bsky.social",
            BSKY_APP_PASSWORD: "app-password",
          },
          () => {
            expect(socialEnabled().bluesky).toBe(true);
          },
        );
      },
    );
  });

  it("reports twitter enabled only when all four credentials are set", () => {
    withEnv(
      {
        TWITTER_API_KEY: undefined,
        TWITTER_API_SECRET: "sec",
        TWITTER_ACCESS_TOKEN: "tok",
        TWITTER_ACCESS_SECRET: "sec2",
      },
      () => {
        expect(socialEnabled().twitter).toBe(false);
      },
    );

    withEnv(
      {
        TWITTER_API_KEY: "key",
        TWITTER_API_SECRET: "sec",
        TWITTER_ACCESS_TOKEN: "tok",
        TWITTER_ACCESS_SECRET: "sec2",
      },
      () => {
        expect(socialEnabled().twitter).toBe(true);
      },
    );
  });

  it("treats empty strings as unconfigured", () => {
    withEnv(
      {
        BSKY_HANDLE: "",
        BSKY_APP_PASSWORD: "",
        TWITTER_API_KEY: "",
      },
      () => {
        expect(socialEnabled()).toEqual({
          bluesky: false,
          twitter: false,
        });
      },
    );
  });
});
