import { AppDataSource, initializeDataSource } from "../data-source";

/**
 * Test DB helper using the application's DataSource singleton.
 *
 * Production Lambda behavior we mirror:
 *   - DB connection initializes ONCE on cold start (first test file)
 *   - NEVER explicitly closed (Lambda containers don't)
 *   - Data cleaned between requests with fast TRUNCATE
 *
 * Jest behavior we rely on:
 *   - maxWorkers: 1 means module cache is shared across test files
 *   - AppDataSource is a module singleton → stays alive everywhere
 */

let initialized = false;

const setUpDB = async () => {
  if (!initialized) {
    try {
      await initializeDataSource();
      initialized = true;
    } catch (e) {
      console.error("Could not establish db connection — is your schema ok?");
      throw e;
    }
  }
};

/**
 * INTENTIONAL NO-OP.
 * Lambda never closes DB connections. The OS reclaims the TCP socket
 * when the Node process exits. Tests mirror this.
 */
const closeDB = async () => {
  // No-op
};

const getEntities = async () => {
  const exclude = ["api_keys"];
  const entities: { name: string; tableName: string }[] = [];
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
