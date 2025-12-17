import "reflect-metadata";
import { initializeDataSource } from "./data-source";
import app from "./app";

(async () => {
  try {
    const dataSource = initializeDataSource();
    await dataSource.initialize();
  } catch (e) {
    console.error("Could not create connection");
    throw e;
  }

  app.listen(3000);

  console.log(
    "Express server has started on port 3000. Open http://localhost:3000/ to see results"
  );
})();
