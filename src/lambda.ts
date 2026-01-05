import * as serverless from "serverless-http";
import { initializeDataSource } from "./data-source";
import app from "./app";

let handler;

const handlerPromise = (async () => {
  await initializeDataSource();
  handler = serverless(app);
  return handler;
})();

module.exports.handler = async (event, context) => {
  const resolvedHandler = await handlerPromise;
  return await resolvedHandler(event, context);
};
