import * as glob from "glob";
import { createConnection } from "typeorm";

import { uploadBulkCSV } from "../src/lib/bulk";
import { normalizeAddress } from "../src/lib/validator/normalizeAddress";
import { Location } from "../src/entity/Location";

const backFillLocations = async (data, _manager) => {
  const [address, type] = Object.values(data).slice(1, 3);
  if (type === "Election Day Voting") {
    const noramlizedAddress = await normalizeAddress(address as string);

    if (noramlizedAddress) {
      const [location] = await Location.getOrCreateFromAddress(
        noramlizedAddress
      );
      await location.validate("democracy works");
    } else {
      throw new Error(`Could not map ${address}`);
    }
  }
  return true;
};

(async () => {
  await createConnection();

  const files: string[] = await new Promise((resolve, reject) => {
    glob(`${process.argv[2]}/*/*.csv`, (er, csvs) => {
      er ? reject(er) : resolve(csvs);
    });
  });

  let count = 0;

  for (const file of files) {
    console.log(`Starting ${file} of ${count + 1} / ${files.length}`);
    await uploadBulkCSV(backFillLocations, file, 0, 100);
    console.log(`Finished ${file} of ${count + 1} / ${files.length}`);
    count += 1;
  }
})();
