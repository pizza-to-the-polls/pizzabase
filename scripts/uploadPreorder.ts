import { uploadBulkCSV } from "../src/lib/bulk";
import { validateReport, validateOrder } from "../src/lib/validator";
import { Order } from "../src/entity/Order";
import { Location } from "../src/entity/Location";

const preOrderReport = async (data: { [key: string]: string }, manager) => {
  const {
    Address,
    Timezone,
    Date: date,
    Time,
    Pizzas,
    Cost,
    Restaurant,
  } = data;
  const zone = {
    Eastern: "-0400",
    Central: "-0500",
    Mountain: "-0600",
    Pacific: "-0700",
  }[Timezone];

  const newNow = new Date(`${date} ${Time} ${zone}`);
  const who = "preorder";
  const [restaurant] = Restaurant.split(/\#[0-9]+\s/)
    .reverse()
    .map((el) => el.trim());

  const { errors, normalizedAddress } = await validateReport({
    url: "http://example.com",
    contact: "fake@example.com",
    address: Address,
  });
  if (Object.keys(errors).length > 0) {
    throw new Error(`Bad address ${Address}`);
  }

  const [location] = await Location.getOrCreateFromAddress(normalizedAddress);
  const orderInput = await validateOrder({
    quantity: Pizzas,
    cost: Cost,
    restaurant,
    user: who,
  });

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
};

(async () => {
  uploadBulkCSV(preOrderReport, process.argv[2], process.argv[3]);
})();
