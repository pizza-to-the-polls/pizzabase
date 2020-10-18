import * as http_mocks from "node-mocks-http";

import { OrdersController } from "./OrdersController";
import { buildTestData } from "../tests/factories";
import { Order } from "../entity/Order";

const controller = new OrdersController();

describe("#recent", () => {
  beforeEach(async () => await buildTestData());

  it("returns a limited number of orders", async () => {
    const body = await controller.recent(
      http_mocks.createRequest({ params: { limit: 2 } }),
      http_mocks.createResponse(),
      () => undefined
    );
    const orders = await Order.find({ take: 2, order: { createdAt: "desc" } });
    expect(body).toEqual({
      count: await Order.count(),
      results: orders.map((order) => ({
        ...order.asJSON(),
        ...order.location.asJSON(),
      })),
    });
  });

  it("returns page 2 limited number of orders", async () => {
    const body = await controller.recent(
      http_mocks.createRequest({ params: { limit: 4, page: 1 } }),
      http_mocks.createResponse(),
      () => undefined
    );

    const orders = await Order.find({
      take: 4,
      skip: 4,
      order: { createdAt: "desc" },
    });
    expect(body).toEqual({
      count: await Order.count(),
      results: orders.map((order) => ({
        ...order.asJSON(),
        ...order.location.asJSON(),
      })),
    });
  });
});
