import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Location } from "./Location";
import { Report } from "./Report";
import { Action } from "./Action";

@Entity({ name: "orders" })
export class Order extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "double precision" })
  cost: number;

  @Column("int")
  pizzas: number;

  @Column({ nullable: true })
  restaurant: string | null;

  @ManyToOne((_type) => Location, (location) => location.orders, {
    eager: true,
    nullable: false,
  })
  location!: Location;

  @OneToMany((_type) => Report, (report) => report.order)
  reports: Report;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  asJSON() {
    const { pizzas, restaurant, createdAt } = this;
    return {
      pizzas,
      restaurant,
      createdAt,
    };
  }

  static async placeOrder(
    {
      pizzas,
      cost,
      restaurant,
      user,
    }: {
      pizzas: number;
      cost: number;
      restaurant?: string;
      user?: string;
    },
    location: Location
  ): Promise<Order> {
    const order = new this();

    order.pizzas = pizzas;
    order.cost = cost;
    order.restaurant = restaurant;
    order.location = location;

    await order.save();

    await Report.bulkUpdate(
      { location, order: null, skippedAt: null },
      { order }
    );

    await Action.log(order, "ordered", user);

    return order;
  }
}
