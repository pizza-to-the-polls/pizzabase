import { createConnection } from "typeorm";
import { APIKey } from "../src/entity/APIKey";

(async () => {
  await createConnection();
  console.log(
    await APIKey.generate(process.argv[2] || "generated from the command line")
  );
})();
