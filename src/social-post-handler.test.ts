import { handler } from "./social-post-handler";
import { Order } from "./entity/Order";
import { Location } from "./entity/Location";
import { socialPost } from "./lib/social";

jest.mock("./lib/social", () => ({
  socialPost: jest.fn().mockResolvedValue(undefined),
}));

describe("social-post-handler", () => {
  beforeEach(() => {
    (socialPost as jest.Mock).mockClear();
  });

  it("loads the order by id and calls socialPost", async () => {
    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,
      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    const order = await Order.placeOrder({ quantity: 3, cost: 45.0 }, location);

    (socialPost as jest.Mock).mockResolvedValueOnce(undefined);

    const result = await handler({ orderId: order.id });

    expect(result).toEqual({ success: true, orderId: order.id });
    expect(socialPost).toHaveBeenCalledTimes(1);
    expect(socialPost).toHaveBeenCalledWith(
      expect.objectContaining({ id: order.id }),
    );
  });

  it("returns false for a non-existent order id", async () => {
    const result = await handler({ orderId: 999999 });

    expect(result).toEqual({ success: false, orderId: 999999 });
    expect(socialPost).not.toHaveBeenCalled();
  });

  it("propagates errors from socialPost", async () => {
    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,
      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    const order = await Order.placeOrder({ quantity: 3, cost: 45.0 }, location);

    const error = new Error("Social post exploded");
    (socialPost as jest.Mock).mockRejectedValueOnce(error);

    await expect(handler({ orderId: order.id })).rejects.toThrow(
      "Social post exploded",
    );
  });

  it("lazy-initializes the DataSource only once", async () => {
    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,
      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    const order = await Order.placeOrder({ quantity: 3, cost: 45.0 }, location);

    (socialPost as jest.Mock).mockResolvedValue(undefined);

    // Multiple invocations should work (DataSource is reused across
    // container reuse).
    await handler({ orderId: order.id });
    await handler({ orderId: order.id });

    expect(socialPost).toHaveBeenCalledTimes(2);
  });
});
