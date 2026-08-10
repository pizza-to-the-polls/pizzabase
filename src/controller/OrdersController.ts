import { Order } from "../entity/Order";
import { Location } from "../entity/Location";
import { addOrderToReport } from "./ReportsController";
import { validateOrder } from "../lib/validator";
import { zapNewOrder } from "../lib/zap";
import { blueskyPost } from "../lib/bluesky";
import { twitterPost } from "../lib/twitter";

import { Controller, Route, Post, BodyProp, Tags } from "./helper";

@Controller("/api/orders") @Tags("Orders")
export class OrdersController {
  @Post("/")
  public async create(
    @BodyProp("locationId") locationId: string,
    @BodyProp("quantity") quantity: number,
    @BodyProp("orderType") orderType: string,
    @BodyProp("cost") cost: number,
    @BodyProp("restaurant") restaurant: string,
  ): Promise<{ order: Order }> {
    validateOrder({ quantity, orderType, cost });
    const location = await Location.findOneOrFail({ where: { id: locationId } });
    const order = await Order.placeOrder({ quantity, orderType, cost, restaurant }, location);
    await Promise.all(order.reports.map((report) => addOrderToReport(report, order)));
    await zapNewOrder(order);
    // Fire-and-forget social posting — never blocks the response.
    blueskyPost(order).catch((err) => console.error("BlueSky post failed:", err));
    twitterPost(order).catch((err) => console.error("Twitter post failed:", err));
    return { order };
  }
}
