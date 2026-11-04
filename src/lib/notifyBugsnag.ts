import Bugsnag from "@bugsnag/js";

// BUG-043: non-Express entrypoints (compileClips, renderClip, scheduled sweeps,
// …) never load the Express middleware that calls Bugsnag.start(), so any
// notify() from those Lambdas was silently dropped with
// "Bugsnag.notify() was called before Bugsnag.start()". Lazily start a
// singleton client on the first notify so every entrypoint can report errors.
let started = false;

export const notifyBugsnag = (err: Error) => {
  try {
    if (!process.env.BUGSNAG_KEY) return;

    if (!started) {
      // Idempotent guard: repeated notify() calls never re-start the client.
      // In Express Lambdas the middleware (initBugSnagMiddleware) starts the
      // SDK first — with the express plugin — and this call is a no-op at the
      // SDK level (it detects it is already configured); middleware init runs
      // at app startup, before any controller code can call notifyBugsnag.
      // autoTrackSessions: false mirrors the middleware's BUG-006 guard (the
      // cold-start session POST fails with TLS resets in Lambda).
      Bugsnag.start({
        apiKey: process.env.BUGSNAG_KEY,
        autoTrackSessions: false,
      });
      started = true;
    }

    Bugsnag.notify(err);
  } catch {
    // Never propagate — Bugsnag being misconfigured or unavailable must not
    // crash the caller.
  }
};
