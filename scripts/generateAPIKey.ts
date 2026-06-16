import { initializeDataSource, AppDataSource } from "../src/data-source";
import { APIKey } from "../src/entity/APIKey";

(async () => {
  await initializeDataSource();
  console.log(
    await APIKey.generate(process.argv[2] || "generated from the command line")
  );
  await AppDataSource.destroy();
})();
