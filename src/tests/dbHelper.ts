import { AppDataSource, initializeDataSource } from "../data-source";

const setUpDB = async () => {
  try {
    await initializeDataSource();
  } catch (e) {
    console.error("Could not establish db connection - is your schema ok?");
    throw e;
  }
};

const closeDB = async () => {
  if (AppDataSource && AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
};

const getEntities = async () => {
  const exclude = ["api_keys"];
  const entities = [];
  AppDataSource.entityMetadatas.forEach(({ name, tableName }) => {
    if (!exclude.includes(tableName)) entities.push({ name, tableName });
  });
  return entities;
};

const cleanAll = async () => {
  const entities = await getEntities();
  try {
    for (const entity of entities) {
      const repository = AppDataSource.getRepository(entity.name);
      await repository.query(`TRUNCATE TABLE ${entity.tableName} CASCADE;`);
    }
  } catch (error) {
    if (!`${error}`.includes("does not exist")) {
      throw new Error(`ERROR: Cleaning test db: ${error}`);
    }
  }
};

export default { cleanAll, setUpDB, closeDB };
