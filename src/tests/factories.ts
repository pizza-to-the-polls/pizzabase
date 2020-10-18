import { Location } from "../entity/Location";
import { Order } from "../entity/Order";
import { Report } from "../entity/Report";

export const buildTestData = async () => {
  const states = ["OR", "WA", "CA", "ID", "MT"];

  for (const state of states) {
    const locations = Math.ceil(Math.random() * 5);
    let orders = Math.ceil(Math.random() * 3);
    const reports = orders + Math.ceil(Math.random() * 5);

    for (let i = 0; i < locations; ++i) {
      const address = {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress: `${i} Street City ${state} 12345`,

        address: `${i} Street`,
        city: "City",
        state,
        zip: "12345",
      };
      const location = await Location.createFromAddress(address);

      for (let j = 0; j < reports; ++j) {
        await Report.createNewReport(
          `${j}@exampe.com`,
          `http://twitter.com/status/${j}`,
          address
        );
        if (orders > 0) {
          await Order.placeOrder(
            {
              pizzas: Math.ceil(Math.random() * 12),
              cost: Math.ceil(Math.random() * 200 * 100) / 100,
            },
            location
          );
          orders += -1;
        }
      }
    }
  }
};
