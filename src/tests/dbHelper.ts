import { DataSource, DataSourceOptions } from "typeorm";
import { initializeDataSource } from "../data-source";

let dataSource: DataSource;

const setUpDB = async () => {
  const config: DataSourceOptions = {
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
  };

  try {
    dataSource = new DataSource(config);
    await dataSource.initialize();
    // Set this as the global AppDataSource for the app to use
    initializeDataSource(dataSource);
  } catch (e) {
    console.error("Could not establish db connection - is your schema ok?");
    throw e;
  }
};

const closeDB = async () => {
  if (dataSource && dataSource.isInitialized) {
    await dataSource.destroy();
  }
};

const getEntities = async () => {
  const exclude = ["api_keys"];
  const entities = [];
  dataSource.entityMetadatas.forEach(({ name, tableName }) => {
    if (!exclude.includes(tableName)) entities.push({ name, tableName });
  });
  return entities;
};

const cleanAll = async () => {
  const entities = await getEntities();
  try {
    for (const entity of entities) {
      const repository = dataSource.getRepository(entity.name);
      await repository.query(`TRUNCATE TABLE ${entity.tableName} CASCADE;`);
    }
  } catch (error) {
    if (!`${error}`.includes("does not exist")) {
      throw new Error(`ERROR: Cleaning test db: ${error}`);
    }
  }
};

export default { cleanAll, setUpDB, closeDB };
