const COST_PER_PIZZA = 16;

interface ValidationError {
  cost?: string;
}

export const validateOrder = ({
  pizzas: sentPizza,
  cost: sentCost,
  restaurant,
  user,
}: {
  pizzas?: string;
  cost?: string;
  restaurant?: string;
  user?: string;
}): {
  pizzas: number;
  cost: number;
  restaurant?: string;
  user?: string;
  errors: ValidationError;
} => {
  const errors: ValidationError = {};

  const cost =
    `${sentCost}`.length > 0
      ? Math.round(Number(`${sentCost}`.match(/[0-9]|\./g)?.join("")) * 100) /
        100
      : null;
  if (!cost) {
    errors.cost = "Invalid Cost - please supply a cost of the order";
  }

  const pizzas = isNaN(Number(sentPizza))
    ? Math.ceil(cost / COST_PER_PIZZA)
    : Number(sentPizza);

  return { errors, cost, pizzas, user, restaurant };
};
