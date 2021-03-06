import * as http_mocks from "node-mocks-http";

import { TotalsController } from "./TotalsController";
import { Location } from "../entity/Location";
import { Order } from "../entity/Order";
import { Donation } from "../entity/Donation";

const controller = new TotalsController();

describe("#overall", () => {
  it("returns the totals for the overall", async () => {
    const states = ["OR", "WA", "CA", "ID", "MT"];
    const overall = {
      costs: 0,
      pizzas: 0,
      snacks: 0,
      states: states.length,
      raised: 0,
      donors: 0,
      locations: 0,
      orders: 0,
    };

    for (let i = 0; i < Math.ceil(Math.random() * 30); ++i) {
      const donation = new Donation();
      donation.amountGross = Math.ceil(Math.random() * 40);
      donation.amount = donation.amountGross - 3;
      donation.email = `donor-${i}@example.com`;
      donation.stripeId = `stripe_code-${i}`;
      donation.postalCode = "12345";
      const cancelled = Math.random() > 0.9;
      if (cancelled) {
        donation.cancelledAt = new Date();
      }
      await donation.save();

      overall.raised += cancelled ? 0 : donation.amountGross;
      overall.donors += cancelled ? 0 : 1;
      overall.costs += cancelled ? 0 : 3;
    }

    for (const state of states) {
      const locations = Math.ceil(Math.random() * 5);
      const orders = Math.ceil(Math.random() * 3);
      for (let i = 0; i < locations; ++i) {
        const location = await Location.createFromAddress({
          latitude: 41.79907,
          longitude: -87.58413,

          fullAddress: `${i} Street City ${state} 12345`,

          address: `${i} Street`,
          city: "City",
          state,
          zip: "12345",
        });
        overall.locations += 1;

        for (let j = 0; j < orders; ++j) {
          const quantity = Math.ceil(Math.random() * 12);
          const cost = Math.ceil(Math.random() * 200);
          await Order.placeOrder({ quantity, cost }, location);

          overall.orders += 1;
          overall.pizzas += quantity;
          overall.snacks += quantity * 10;
          overall.costs += cost;
        }
      }
    }

    const body = await controller.overall(
      http_mocks.createRequest(),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body).toEqual(overall);
  });
});

describe("#yearly", () => {
  it("returns the yearly total for this year, not for other year", async () => {
    const states = ["OR", "WA", "CA", "ID", "MT"];
    const overall = {
      costs: 0,
      pizzas: 0,
      snacks: 0,
      raised: 0,
      donors: 0,
      states: states.length,
      locations: 0,
      orders: 0,
    };

    for (let i = 0; i < Math.ceil(Math.random() * 30); ++i) {
      const donation = new Donation();
      donation.amountGross = Math.ceil(Math.random() * 40);
      donation.amount = donation.amountGross - 3;
      donation.email = `donor-${i}@example.com`;
      donation.stripeId = `stripe_code-${i}`;
      donation.postalCode = "12345";
      const cancelled = Math.random() > 0.9;
      if (cancelled) {
        donation.cancelledAt = new Date();
      }
      await donation.save();

      overall.raised += cancelled ? 0 : donation.amountGross;
      overall.donors += cancelled ? 0 : 1;
      overall.costs += cancelled ? 0 : 3;
    }

    for (const state of states) {
      const locations = Math.ceil(Math.random() * 5);
      const orders = Math.ceil(Math.random() * 3);
      for (let i = 0; i < locations; ++i) {
        const location = await Location.createFromAddress({
          latitude: 41.79907,
          longitude: -87.58413,

          fullAddress: `${i} Street City ${state} 12345`,

          address: `${i} Street`,
          city: "City",
          state,
          zip: "12345",
        });
        overall.locations += 1;

        for (let j = 0; j < orders; ++j) {
          const quantity = Math.ceil(Math.random() * 12);
          const cost = Math.ceil(Math.random() * 200);
          await Order.placeOrder({ quantity, cost }, location);

          overall.orders += 1;
          overall.pizzas += quantity;
          overall.snacks += quantity * 10;
          overall.costs += cost;
        }
      }
    }

    const thisBody = await controller.yearly(
      http_mocks.createRequest({
        params: { year: `${new Date().getFullYear()}` },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(thisBody).toEqual(overall);

    const pastBody = await controller.yearly(
      http_mocks.createRequest({ params: { year: `2009` } }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(pastBody).toEqual({
      costs: 0,
      pizzas: 0,
      snacks: 0,
      states: 0,
      raised: 0,
      donors: 0,
      locations: 0,
      orders: 0,
    });
  });
});
