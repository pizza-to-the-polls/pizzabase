import { createConnection, getConnection, ConnectionOptions } from "typeorm";

const setUpDB = async () => {
  const config: ConnectionOptions = {
    name: "default",
    type: "postgres",
    port: 5432,
    username: process.env.POSTGRES_USERNAME || "postgres",
    database: process.env.POSTGRES_DB || "pizzabaseTest",
    password: process.env.POSTGRES_PASSWORD,
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

  try {
    await createConnection(config);
  } catch (e) {
    console.error("Could not establish db connection - is your schema ok?");
    throw e;
  }
};

const closeDB = async () => {
  const conn = await getConnection();
  await conn.close();
};

const getEntities = async () => {
  const exclude = ["api_keys"];
  const entities = [];
  const conn = await getConnection();
  (await conn.entityMetadatas).forEach(({ name, tableName }) => {
    if (!exclude.includes(tableName)) entities.push({ name, tableName });
  });
  return entities;
};

const cleanAll = async () => {
  const entities = await getEntities();
  const conn = await getConnection();
  try {
    for (const entity of entities) {
      const repository = await conn.getRepository(entity.name);
      await repository.query(`TRUNCATE TABLE ${entity.tableName} CASCADE;`);
    }
  } catch (error) {
    if (!`${error}`.includes("does not exist")) {
      throw new Error(`ERROR: Cleaning test db: ${error}`);
    }
  }
};

export default { cleanAll, setUpDB, closeDB };
