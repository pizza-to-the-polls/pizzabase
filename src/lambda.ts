import * as serverless from "serverless-http";
import { AppDataSource, initializeDataSource } from "./data-source";
import app from "./app";

const handler = serverless(app);

const setUpDB = async () => {
  try {
    if (!AppDataSource || !AppDataSource.isInitialized) {
      const dataSource = initializeDataSource();
      await dataSource.initialize();
    }
  } catch (e) {
    console.error("Could not create connection");
    throw e;
  }
};

module.exports.handler = async (event, context) => {
  await setUpDB();
  return await handler(event, context);
};
