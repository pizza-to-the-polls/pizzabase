import Bugsnag from "@bugsnag/js";
import BugsnagPluginExpress from "@bugsnag/plugin-express";

let middleware;

export const initBugSnagMiddleware = () => {
  if (process.env.BUGSNAG_KEY) {
    Bugsnag.start({
      apiKey: process.env.BUGSNAG_KEY,
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
