import { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../data-source";

export class TotalsController {
  private toNumber(object): { [key: string]: number } {
    return Object.keys(object).reduce((obj, el) => {
      obj[el] = `${object[el]}`.includes(".")
        ? Number(Math.floor(object[el] * 100) / 100)
        : Number(object[el]);
      return obj;
    }, {});
  }
  private toTotals(totals) {
    const { fees, ...rest } = this.toNumber(totals);
    rest.costs = Math.floor((totals.costs + fees) * 100) / 100;
    return rest;
  }
  private ORDER_QUERY = `
    SELECT
      SUM(orders.cost) as costs,
      SUM(orders.quantity) as pizzas,
      SUM(orders.snacks) as snacks,
      COUNT(DISTINCT orders.id) as orders,
      COUNT(DISTINCT locations.id) as locations,
      COUNT(DISTINCT locations.state) as states
    FROM orders
    LEFT JOIN locations ON orders.location_id = locations.id
    WHERE orders.cancelled_at is NULL
  `;
  private DONATION_QUERY = `
    SELECT
      SUM(donations.amount_gross) as raised,
      SUM(donations.amount_gross) - SUM(donations.amount) as fees,
      COUNT(DISTINCT donations.email) as donors
    FROM donations
    WHERE cancelled_at is NULL
  `;
  async overall(_request: Request, _response: Response, _next: NextFunction) {
    const manager = AppDataSource.manager;

    return this.toTotals({
      ...(await manager.query(this.DONATION_QUERY))[0],
      ...(await manager.query(this.ORDER_QUERY))[0],
    });
  }
  async yearly(request: Request, _response: Response, _next: NextFunction) {
    const manager = AppDataSource.manager;
    const year = (request.params.year || "").replace(/\D/g, "");

    return this.toTotals({
      ...(
        await manager.query(
          `${this.DONATION_QUERY} AND date_part('year', donations.created_at) = ${year}`
        )
      )[0],
      ...(
        await manager.query(
          `${this.ORDER_QUERY} AND date_part('year', orders.created_at) = ${year}`
        )
      )[0],
    });
  }
}
