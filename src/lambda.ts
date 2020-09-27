import * as serverless from "serverless-http";
import { createConnection } from "typeorm";
import app from "./app";

const handler = serverless(app);

let connection;

const setUpDB = async () => {
  try {
    if (!connection) connection = await createConnection();
  } catch (e) {
    console.error("Could not create connection");
    throw e;
  }
};

module.exports.handler = async (event, context) => {
  await setUpDB();
  return await handler(event, context);
};
