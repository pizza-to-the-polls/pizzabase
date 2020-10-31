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
  private ORDER_QUERY = `
    SELECT
      SUM(orders.cost) as costs,
      SUM(orders.quantity) as pizzas,
      SUM(orders.meals) as meals,
      COUNT(DISTINCT orders.id) as orders,
      COUNT(DISTINCT locations.id) as locations,
      COUNT(DISTINCT locations.state) as states
    FROM orders
    LEFT JOIN locations ON orders.location_id = locations.id
  `;
  private DONATION_QUERY = `
    SELECT
      SUM(donations.amount) as raised,
      COUNT(DISTINCT donations.email) as donors
    FROM donations
    WHERE cancelled_at is NULL
  `;
  async overall(_request: Request, _response: Response, _next: NextFunction) {
    const { manager } = await getConnection();

    return this.toNumber({
      ...(await manager.query(this.DONATION_QUERY))[0],
      ...(await manager.query(this.ORDER_QUERY))[0],
    });
  }
  async yearly(request: Request, _response: Response, _next: NextFunction) {
    const { manager } = await getConnection();
    const year = (request.params.year || "").replace(/\D/g, "");

    return this.toNumber({
      ...(
        await manager.query(
          `${this.DONATION_QUERY} AND date_part('year', donations.created_at) = ${year}`
        )
      )[0],
      ...(
        await manager.query(
          `${this.ORDER_QUERY} WHERE date_part('year', orders.created_at) = ${year}`
        )
      )[0],
    });
  }
}
