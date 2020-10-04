import * as serverless from "serverless-http";
import { createConnection, Connection } from "typeorm";
import app from "./app";

const handler = serverless(app);

let connection: Connection | null;

const setUpDB = async (): Promise<Connection | null> => {
  try {
    if (!connection) {
      return await createConnection();
    } else {
      if (connection.isConnected) {
        return connection;
      } else {
        await connection.connect();
      }
    }
  } catch (e) {
    console.error("Could not create connection");
    throw e;
  }
};

module.exports.handler = async (event, context) => {
  connection = await setUpDB();
  return await handler(event, context);
};
