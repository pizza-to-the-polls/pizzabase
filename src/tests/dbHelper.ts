import test from "ava";

import { createConnection, getConnection } from "typeorm";

export const setUpDB = async () => {
  await createConnection({
    type: "postgres",
    database: "pizzabaseTest",
    dropSchema: true,
    synchronize: true,
    logging: false,
    entities: ["src/entity/**/*.ts"],
    migrations: ["src/migration/**/*.ts"],
    subscribers: ["src/subscriber/**/*.ts"],
    cli: {
      entitiesDir: "src/entity",
      migrationsDir: "src/migration",
      subscribersDir: "src/subscriber",
    },
  });
};

export const closeDB = async () => {
  const conn = await getConnection();
  await conn.close();
};

export default { setUpDB, closeDB };
