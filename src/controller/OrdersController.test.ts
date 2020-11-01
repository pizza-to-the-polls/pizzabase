import * as http_mocks from "node-mocks-http";

import { OrdersController } from "./OrdersController";
import { buildTestData } from "../tests/factories";
import { Order } from "../entity/Order";
import { Location } from "../entity/Location";
import { ADDRESS_ERROR, COST_ERROR } from "../lib/validator/constants";

jest.mock("../lib/validator/geocode");

const controller = new OrdersController();

describe("#show", () => {
  beforeEach(async () => await buildTestData());

  it("returns an order", async () => {
    const order = await Order.findOne();
    const body = await controller.show(
      http_mocks.createRequest({ params: { id: `${order.id}` } }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual({
      ...order.asJSON(),
      location: await order.location.asJSON(),
      reports: (await order.reports).map((report) => report.asJSON()),
    });
  });
});

describe("#delete", () => {
  beforeEach(async () => await buildTestData());

  it("cancells an order and opens it's reports", async () => {
    const order = await Order.findOne();
    const [report] = await order.reports;
    const { cost, quantity } = order;

    await controller.delete(
      http_mocks.createRequest({
        params: { id: `${order.id}` },
        body: { cancelledBy: "scott", cancelNote: "yeah not feeling it" },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    await order.reload();
    expect(order.cancelNote).toContain(
      `note: yeah not feeling it, quantity: ${quantity}, cost: ${cost}`
    );
    expect(order.quantity).toEqual(0);
    expect(order.meals).toEqual(0);
    expect(order.cost).toEqual(0);
    expect(order.cancelledAt).toBeTruthy();
    await report.reload();
    expect(report.order).toBeFalsy();
  });
});

describe("#index", () => {
  beforeEach(async () => await buildTestData());

  it("returns a limited number of orders", async () => {
    const body = await controller.index(
      http_mocks.createRequest({ query: { limit: 2 } }),
      http_mocks.createResponse(),
      () => undefined
    );
    const orders = await Order.find({ take: 2, order: { createdAt: "DESC" } });
    expect(body).toEqual({
      count: await Order.count(),
      results: await Promise.all(
        orders.map(async (order) => ({
          ...order.asJSON(),
          location: await order.location.asJSON(),
          reports: (await order.reports).map((report) => report.asJSON()),
        }))
      ),
    });
  });

  it("returns page 2 limited number of orders", async () => {
    const body = await controller.index(
      http_mocks.createRequest({ query: { limit: 4, page: 1 } }),
      http_mocks.createResponse(),
      () => undefined
    );

    const orders = await Order.find({
      take: 4,
      skip: 4,
      order: { createdAt: "DESC" },
    });
    expect(body).toEqual({
      count: await Order.count(),
      results: await Promise.all(
        orders.map(async (order) => ({
          ...order.asJSON(),
          location: await order.location.asJSON(),
          reports: (await order.reports).map((report) => report.asJSON()),
        }))
      ),
    });
  });
});

describe("#create", () => {
  it("returns validation errors", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.create(
      http_mocks.createRequest({
        method: "POST",
        body: { address: null, cost: null },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined
    );
    expect(body).toEqual({
      errors: {
        cost: COST_ERROR,
        address: ADDRESS_ERROR,
      },
    });
    expect(response.statusCode).toEqual(422);
  });

  it("can create an order on an existing location", async () => {
    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    await controller.create(
      http_mocks.createRequest({
        method: "POST",
        body: { cost: "$500.23423", address: location.fullAddress },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    await location.reload();
    const [order] = await location.orders;

    expect(order.cost).toEqual(500.23);
    expect(order.quantity).toEqual(32);
    expect(location.validatedAt).toBeTruthy();
  });

  it("can create an order on a new location", async () => {
    await controller.create(
      http_mocks.createRequest({
        method: "POST",
        body: {
          cost: "$500.23423",
          address: "550 Different Address City OR 12345",
        },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    const order = await Order.findOne({ where: { cost: 500.23 } });

    expect(order.quantity).toEqual(32);
    expect(order.location.fullAddress).toEqual(
      "550 Different Address City OR 12345"
    );
    expect(order.location.validatedAt).toBeTruthy();
  });
});
