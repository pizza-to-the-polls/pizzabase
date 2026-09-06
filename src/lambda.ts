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

module.exports.handler = async (event, context) => {
  // serverless-http defaults callbackWaitsForEmptyEventLoop to false,
  // which kills all pending promises (socialPost, et al) as soon as
  // the HTTP response is sent. Flip it so fire-and-forget work completes.
  context.callbackWaitsForEmptyEventLoop = true;
  const resolvedHandler = await handlerPromise;
  return await resolvedHandler(event, context);
};
