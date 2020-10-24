import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { NormalAddress } from "../lib/validator";
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
  @JoinColumn({ name: "location_id" })
  location!: Location;

  @OneToMany((_type) => Report, (report) => report.order)
  reports: Promise<Report[]>;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  asJSON(showPrivate: boolean = false) {
    if (showPrivate) return this.asJSONPrivate();

    const { id, pizzas, restaurant, createdAt } = this;
    return {
      id,
      pizzas,
      restaurant,
      createdAt,
    };
  }

  asJSONPrivate() {
    const { cost } = this;
    return {
      ...this.asJSON(),
      cost,
    };
  }

  static async placeOrderForAddress(
    orderParams: {
      pizzas: number;
      cost: number;
      restaurant?: string;
      user?: string;
    },
    address: NormalAddress
  ): Promise<Order> {
    const [location] = await Location.getOrCreateFromAddress(address);

    return await this.placeOrder(orderParams, location);
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

    await Report.updateOpen(location, { order });
    await location.validate(user);

    await Action.log(order, "ordered", user);

    return order;
  }
}
