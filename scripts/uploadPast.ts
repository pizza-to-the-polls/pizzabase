import { createConnection, getConnection } from "typeorm";
import * as csv from "csv-parser";
import * as fs from "fs";

import { validateReport, validateOrder } from "../src/lib/validator";
import { Order } from "../src/entity/Order";
import { Report } from "../src/entity/Report";

const backfillReport = async (data: { [key: string]: string }) => {
  const {
    who,
    status,
    timestamp,
    cost,
    pizzas,
    full_address,
    url,
    contact,
  } = data;
  const { manager } = await getConnection();

  const newNow = new Date(timestamp);

  const { errors, normalizedAddress } = await validateReport({
    url: "http://example.com",
    contact: "fake@example.com",
    address: full_address,
  });
  if (Object.keys(errors).length > 0) {
    throw new Error(`Bad address ${full_address}`);
  }

  const [report] = await Report.createNewReport(
    contact,
    url,
    normalizedAddress
  );
  const { location } = report;
  const orderInput = validateOrder({ quantity: pizzas, cost, user: who });

  if (status === "Delivered" && orderInput.cost) {
    const order = await Order.placeOrder(orderInput, location);
    await location.validate(who);
    await manager.query(`
        UPDATE orders SET created_at = '${newNow.toISOString()}', updated_at = '${newNow.toISOString()}' WHERE id = ${
      order.id
    }
      `);
    await manager.query(`
        UPDATE locations SET created_at = '${newNow.toISOString()}', updated_at = '${newNow.toISOString()}', validated_at = '${newNow.toISOString()}' WHERE id = ${
      location.id
    }
      `);
    await manager.query(`
        UPDATE reports SET created_at = '${newNow.toISOString()}', updated_at = '${newNow.toISOString()}' WHERE id = ${
      report.id
    }
      `);
  } else {
    await location.skip(who);
    await manager.query(`
        UPDATE locations SET created_at = '${newNow.toISOString()}', updated_at = '${newNow.toISOString()}' WHERE id = ${
      location.id
    }
      `);
    await manager.query(`
        UPDATE reports SET created_at = '${newNow.toISOString()}', updated_at = '${newNow.toISOString()}', skipped_at = '${newNow.toISOString()}' WHERE id = ${
      report.id
    }
      `);
  }
};

(async () => {
  await createConnection();

  const data: { [key: string]: string }[] = await new Promise((resolve) => {
    const rows = [];
    fs.createReadStream(process.argv[2])
      .pipe(csv())
      .on("data", (row) => {
        rows.push(row);
      })
      .on("end", () => {
        resolve(rows);
      });
  });

  for (let num = 9; num < data.length; ++num) {
    try {
      await backfillReport(data[num]);
    } catch (e) {
      console.error(e);
    }
    console.log(`${num + 1} / ${data.length} done`);
    await new Promise((accept) => setTimeout(accept, 250));
  }
})();
