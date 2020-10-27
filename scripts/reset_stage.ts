import { createConnection, getConnection } from "typeorm";

(async () => {
  await createConnection();
  const { manager } = await getConnection();
  manager.query(`
    SELECT pg_terminate_backend (pid) FROM pg_stat_activity WHERE datname = 'pizzabasestage';
    DROP DATABASE pizzabasestage;
    SELECT pg_terminate_backend (pid) FROM pg_stat_activity WHERE datname = 'pizzabase';
    CREATE DATABASE pizzabasestage WITH TEMPLATE pizzabase;
  `);
})();
