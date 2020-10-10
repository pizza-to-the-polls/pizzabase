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

interface Details {
  pizzas: string | number;
  cost: string | number;
  restaurant?: string;
  user?: string;
}

@Entity({ name: "orders" })
export class Order extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  cost!: number;

  @Column()
  pizzas!: number;

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

  static async placeOrder(
    { pizzas, cost, restaurant, user }: Details,
    location: Location
  ): Promise<Order> {
    const order = new this();
    order.pizzas = Number(pizzas);
    order.cost = Number(cost);
    order.restaurant = restaurant;
    order.location = location;

    await order.save();

    await Report.createQueryBuilder()
      .update(Report)
      .set({ order })
      .where({ location, order: null })
      .execute();

    await Action.log(order, "ordered", user);

    return order;
  }
}
