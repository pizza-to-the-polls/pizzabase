import * as serverless from "serverless-http";
import { initializeDataSource } from "./data-source";
import app from "./app";

let handler;

(async () => {
  await initializeDataSource();
  handler = serverless(app);
})();

module.exports.handler = async (event, context) => {
  return await handler(event, context);
};
