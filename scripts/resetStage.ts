import { initializeDataSource, AppDataSource } from "../src/data-source";

(async () => {
  await initializeDataSource();
  const manager = AppDataSource.manager;
  manager.query(`
    SELECT pg_terminate_backend (pid) FROM pg_stat_activity WHERE datname = 'pizzabasestage';
    DROP DATABASE pizzabasestage;
    SELECT pg_terminate_backend (pid) FROM pg_stat_activity WHERE datname = 'pizzabase';
    CREATE DATABASE pizzabasestage WITH TEMPLATE pizzabase;
  `);
  await AppDataSource.destroy();
})();
