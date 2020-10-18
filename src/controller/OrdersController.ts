import { NextFunction, Request, Response } from "express";

import { Order } from "../entity/Order";

export class OrdersController {
  async recent(request: Request, _response: Response, _next: NextFunction) {
    const limit = Number(request.params.limit || 100);
    const take = limit < 100 ? limit : 100;

    const skip = Number(request.params.page || 0) * limit;

    const [orders, count] = await Order.findAndCount({
      relations: ["reports"],
      order: { createdAt: "DESC" },
      take,
      skip,
    });

    const results = await Promise.all(
      orders.map(async (order) => ({
        ...order.asJSON(),
        location: order.location.asJSON(),
        reports: (await order.reports).map((report) => report.asJSON()),
      }))
    );
    return { results, count };
  }
}
