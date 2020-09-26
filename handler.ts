import * as serverless from "serverless-http";
import { createConnection } from "typeorm";
import app from "./src/app";

const handler = serverless(app);

module.exports.handler = async (event, context) => {
  try {
    await createConnection();
  } catch (e) {
    console.error("Could not create connection");
    throw e;
  }

  return await handler(event, context);
};
