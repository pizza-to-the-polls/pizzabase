import { createConnection, getConnection } from "typeorm";

export const setUpDB = async () => {
  const config: any = {
    type: "postgres",
    database: process.env.POSTGRES_DB || "pizzabaseTest",
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
  };

  if (process.env.POSTGRES_PASSWORD)
    config.password = process.env.POSTGRES_PASSWORD;
  if (process.env.POSTGRES_PASSWORD)
    config.username = process.env.POSTGRES_USERNAME;

  await createConnection(config);
};

export const closeDB = async () => {
  const conn = await getConnection();
  await conn.close();
};

export default { setUpDB, closeDB };
