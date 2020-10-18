import { NextFunction, Request, Response } from "express";

import { Order } from "../entity/Order";

export class OrdersController {
  async recent(request: Request, _response: Response, _next: NextFunction) {
    const limit = Number(request.params.limit || 100);
    const take = limit < 100 ? limit : 100;

    const skip = Number(request.params.page || 0) * limit;

    const [orders, count] = await Order.findAndCount({
      join: { alias: "location" },
      order: { createdAt: "DESC" },
      take,
      skip,
    });
    const results = orders.map((order) => ({
      ...order.asJSON(),
      ...order.location.asJSON(),
    }));
    return { results, count };
  }
}
