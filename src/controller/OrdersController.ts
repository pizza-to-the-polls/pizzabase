import { NextFunction, Request, Response } from "express";
import { isAuthorized, findOr404 } from "./helper";
import { Order } from "../entity/Order";
import { validateOrder } from "../lib/validator";
import { zapNewOrder } from "../lib/zapier";

export class OrdersController {
  async create(request: Request, response: Response, next: NextFunction) {
    if (!(await isAuthorized(request, response, next))) return null;

    const { errors, normalizedAddress, ...rawOrder } = await validateOrder({
      ...request.body,
      address: request.body?.address || "bad-address",
    });

    if (Object.keys(errors).length > 0) {
      response.status(422);
      return { errors };
    }
    const order = await Order.placeOrderForAddress(rawOrder, normalizedAddress);

    await zapNewOrder(order);

    return { address: order.location.fullAddress };
  }

  async show(request: Request, response: Response, next: NextFunction) {
    const order: Order = await findOr404(
      await Order.findOne({ where: { id: Number(request.params.id || "") } }),
      response,
      next
    );
    if (!order) return;

    return {
      ...order.asJSON(),
      location: await order.location.asJSON(),
      reports: (await order.reports).map((report) => report.asJSON()),
    };
  }

  async index(request: Request, _response: Response, _next: NextFunction) {
    const limit = Number(request.query.limit || 100);
    const take = limit < 100 ? limit : 100;

    const skip = Number(request.query.page || 0) * take;

    const [orders, count] = await Order.findAndCount({
      relations: ["reports", "location"],
      order: { createdAt: "DESC" },
      take,
      skip,
    });

    const results = await Promise.all(
      orders.map(async (order) => ({
        ...order.asJSON(),
        location: await order.location.asJSON(),
        reports: (await order.reports).map((report) => report.asJSON()),
      }))
    );
    return { results, count };
  }
}
