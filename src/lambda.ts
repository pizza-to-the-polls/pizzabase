import "reflect-metadata";
import serverless from "serverless-http";
import { initializeDataSource } from "./data-source";
import app from "./app";

let handler;

const handlerPromise = (async () => {
  await initializeDataSource();
  handler = serverless(app);
  return handler;
})();

module.exports.handler = (event, context, callback) => {
  // Keep the invocation alive after the HTTP response is delivered so
  // fire-and-forget work (socialPost) can finish. NOTE: this only works with
  // Respond as soon as the app handler resolves — social posting is now a
  // separate onSocialPost Lambda invoked async (Event) from the controllers,
  // so no in-process background work needs this invocation held open.
  context.callbackWaitsForEmptyEventLoop = false;
  handlerPromise
    .then((resolvedHandler) => resolvedHandler(event, context))
    .then((result) => callback(null, result))
    .catch((err) => callback(err));
};
