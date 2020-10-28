import { uploadBulkCSV } from "../src/lib/bulk";
import { validateReport, validateOrder } from "../src/lib/validator";
import { Order } from "../src/entity/Order";
import { Report } from "../src/entity/Report";

const SUCCESS = /Done|Delivered/i;

const backfillReport = async (data: { [key: string]: string }, manager) => {
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

  const newNow = new Date(timestamp);

  const { errors, normalizedAddress } = await validateReport({
    url: "http://example.com",
    contact: "fake@example.com",
    address: full_address,
  });

  if (!normalizedAddress || Object.keys(errors).length > 0) {
    throw new Error(`Bad address ${full_address}`);
  }
  if (newNow < new Date("10/24/2016")) {
    throw new Error(`Bad date ${newNow}`);
  }

  const [report] = await Report.createNewReport(
    contact,
    url,
    normalizedAddress
  );
  const { location } = report;
  const orderInput = await validateOrder({ quantity: pizzas, cost, user: who });

  if (status.match(SUCCESS) && orderInput.cost) {
    const [order] = await Order.placeOrder(orderInput, location);
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
  return true;
};

(async () => {
  uploadBulkCSV(backfillReport, process.argv[2], process.argv[3]);
})();
