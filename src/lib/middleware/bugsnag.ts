import Bugsnag from "@bugsnag/js";
import BugsnagPluginExpress from "@bugsnag/plugin-express";

let middleware;

export const initBugSnagMiddleware = () => {
  if (process.env.BUGSNAG_KEY) {
    Bugsnag.start({
      apiKey: process.env.BUGSNAG_KEY,
      // Disable auto session tracking: sessions are a browser/mobile concept and
      // the cold-start POST to sessions.bugsnag.com intermittently fails with
      // TLS resets in Lambda (ECONNRESET), producing noisy ERROR logs.
      autoTrackSessions: false,
      plugins: [BugsnagPluginExpress],
    });

    middleware = Bugsnag.getPlugin("express");
  }

  return {
    addBugSnagRequestHandler: (app) => {
      if (middleware) {
        app.use(middleware.requestHandler);
      }
    },
    addBugSnagErrorHandler: (app) => {
      if (middleware) {
        app.use(middleware.errorHandler);
      }
    },
  };
};
