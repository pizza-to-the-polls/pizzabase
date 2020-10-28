import { normalizeAddress } from "./normalizeAddress";
import { NormalAddress } from "./types";
import { ADDRESS_ERROR, COST_ERROR, ORDER_TYPE_ERROR } from "./constants";
import { OrderTypes } from "../../entity/Order";

const COST_PER_PIZZA = 16;

interface ValidationError {
  cost?: string;
  address?: string;
  orderType?: string;
}

export const validateOrder = async ({
  pizzas: sentPizza,
  cost: sentCost,
  quantity: sentQuantity,
  orderType: sentOrderType,
  restaurant,
  user,
  address,
}: {
  pizzas?: string;
  cost?: string;
  restaurant?: string;
  orderType?: string;
  quantity?: string;
  user?: string;
  address?: string;
}): Promise<{
  cost: number;
  orderType: OrderTypes;
  quantity: number;
  restaurant?: string;
  user?: string;
  normalizedAddress?: NormalAddress;
  errors: ValidationError;
}> => {
  const errors: ValidationError = {};

  const cost =
    `${sentCost}`.length > 0
      ? Math.round(Number(`${sentCost}`.match(/[0-9]|\./g)?.join("")) * 100) /
        100
      : null;
  if (!cost) {
    errors.cost = COST_ERROR;
  }
  let normalizedAddress: null | NormalAddress;
  if (!!address) {
    normalizedAddress = await normalizeAddress(address);
    if (!normalizedAddress) {
      errors.address = ADDRESS_ERROR;
    }
  }

  const pizzas = isNaN(Number(sentPizza))
    ? Math.ceil(cost / COST_PER_PIZZA)
    : Number(sentPizza);

  const quantity = isNaN(Number(sentQuantity)) ? pizzas : Number(sentQuantity);
  const orderType = OrderTypes[sentOrderType || "pizzas"];

  if (!orderType) {
    errors.orderType = ORDER_TYPE_ERROR;
  }

  return {
    errors,
    cost,
    user,
    restaurant,
    normalizedAddress,
    orderType,
    quantity,
  };
};
