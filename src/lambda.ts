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
  // Keep the event loop alive for fire-and-forget work (social posting).
  // The Node runtime defaults callbackWaitsForEmptyEventLoop to true,
  // but being explicit avoids surprises with wrappers that flip it.
  context.callbackWaitsForEmptyEventLoop = true;
  const resolvedHandler = await handlerPromise;
  return await resolvedHandler(event, context);
};
