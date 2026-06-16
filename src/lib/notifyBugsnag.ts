import Bugsnag from "@bugsnag/js";

export const notifyBugsnag = (err: Error) => {
  try {
    if (process.env.BUGSNAG_KEY) {
      Bugsnag.notify(err);
    }
  } catch {
    // Ignore when Bugsnag isn't configured (e.g. in unit tests without env vars)
  }
};
