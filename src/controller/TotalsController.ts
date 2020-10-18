import { NextFunction, Request, Response } from "express";
import { getConnection } from "typeorm";

export class TotalsController {
  private toNumber(object) {
    return Object.keys(object).reduce((obj, el) => {
      obj[el] = `${object[el]}`.includes(".")
        ? Number(Math.floor(object[el] * 100) / 100)
        : Number(object[el]);
      return obj;
    }, {});
  }
  private QUERY = `SELECT
      SUM(orders.cost) as costs,
      SUM(orders.pizzas) as pizzas,
      COUNT(DISTINCT orders.id) as orders,
      COUNT(DISTINCT locations.id) as locations,
      COUNT(DISTINCT locations.state) as states
    FROM orders
    LEFT JOIN locations ON orders.location_id = locations.id
  `;
  async overall(_request: Request, _response: Response, _next: NextFunction) {
    const { manager } = await getConnection();

    return this.toNumber((await manager.query(this.QUERY))[0]);
  }
  async yearly(request: Request, _response: Response, _next: NextFunction) {
    const { manager } = await getConnection();
    const year = (request.params.year || "").replace(/\D/g, "");

    return this.toNumber(
      (
        await manager.query(
          `${this.QUERY} WHERE date_part('year', orders.created_at) = ?`,
          [year]
        )
      )[0]
    );
  }
}
