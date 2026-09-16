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
  // callback-style handlers — async handlers end the invocation as soon as
  // they resolve, freezing background promises at the next await point
  // (observed on staging: socialPost died 6ms after "rendered message").
  context.callbackWaitsForEmptyEventLoop = true;
  handlerPromise
    .then((resolvedHandler) => resolvedHandler(event, context))
    .then((result) => callback(null, result))
    .catch((err) => callback(err));
};
