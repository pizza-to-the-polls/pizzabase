import { createConnection, getConnection, EntityManager } from "typeorm";
import * as csv from "csv-parser";
import * as fs from "fs";

export const uploadBulkCSV = async (
  callback: (
    data: { [key: string]: string },
    manager: EntityManager
  ) => Promise<boolean>,
  csvFile: string,
  start: string | number | null = 0
) => {
  await createConnection();
  const { manager } = await getConnection();
  const failures = [];

  const data: { [key: string]: string }[] = await new Promise((resolve) => {
    const rows = [];
    fs.createReadStream(csvFile)
      .pipe(csv())
      .on("data", (row) => {
        rows.push(row);
      })
      .on("end", () => {
        resolve(rows);
      });
  });

  for (let num = Number(start || 0); num < data.length; ++num) {
    const row = data[num];
    let success;
    let msg;
    try {
      success = await callback(row, manager);
    } catch (e) {
      success = false;
      msg = e;
    }
    if (!success) failures.push(row);

    console.log(
      `${num + 1} / ${data.length} ${success ? "success" : `fail with ${msg}`}`
    );
    await new Promise((accept) => setTimeout(accept, 150));
  }

  console.log(failures.map((row) => Object.values(row).join(",")).join("\n"));
};
