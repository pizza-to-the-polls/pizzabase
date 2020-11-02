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
  Index,
} from "typeorm";
import { NormalAddress } from "../lib/validator";
import { Location } from "./Location";
import { Report } from "./Report";
import { Action } from "./Action";

export enum OrderTypes {
  pizzas = "pizzas",
  donuts = "dozen donuts",
}

export const ORDER_TYPE_TO_SNACKS: {
  [key in OrderTypes]: number;
} = {
  [OrderTypes.pizzas]: 10,
  [OrderTypes.donuts]: 12,
};

@Entity({ name: "orders" })
export class Order extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "double precision" })
  cost: number;

  @Column({ type: "int" })
  snacks: number;

  @Column({ name: "order_type", default: "pizzas" })
  @Index()
  orderType: OrderTypes;

  @Column({ type: "int" })
  quantity: number;

  @Column({ nullable: true })
  @Index()
  restaurant: string | null;

  @ManyToOne((_type) => Location, (location) => location.orders, {
    eager: true,
    nullable: false,
  })
  @JoinColumn({ name: "location_id" })
  @Index()
  location!: Location;

  @OneToMany((_type) => Report, (report) => report.order)
  reports: Promise<Report[]>;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  @Column({
    name: "cancelled_at",
    type: "timestamp with time zone",
    nullable: true,
  })
  cancelledAt: Date;

  @Column({ name: "cancel_note", nullable: true })
  cancelNote: string;

  async distributor(): Promise<Report | null> {
    const [reports] = await Report.allReports({ order: this });
    return (reports?.canDistribute || 0) > 0 ? reports : null;
  }

  async cancelAndZero(cancelledBy?: string): Promise<Report[]> {
    this.cancelledAt = new Date();
    this.cancelNote = `quantity: ${this.quantity}, cost: ${this.cost}`;
    this.quantity = 0;
    this.snacks = 0;
    this.cost = 0;
    await this.save();

    const reports = await Report.find({ where: { order: this } });

    if (reports) {
      await Report.createQueryBuilder()
        .update(Report)
        .where({ order: this })
        .set({ order: null })
        .execute();
    }
    await Action.log(this, "cancelled order", cancelledBy);

    return reports;
  }

  asJSON(showPrivate: boolean = false) {
    if (showPrivate) return this.asJSONPrivate();

    const {
      id,
      snacks,
      quantity,
      orderType,
      restaurant,
      createdAt,
      cancelledAt,
      cancelNote,
    } = this;
    return {
      id,
      snacks,
      quantity,
      orderType,
      pizzas: quantity,
      restaurant,
      createdAt,
      cancelledAt,
      cancelNote,
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
      quantity: number;
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
      cost,
      orderType,
      quantity,
      restaurant,
      user,
    }: {
      cost: number;
      quantity: number;
      restaurant?: string;
      orderType?: OrderTypes;
      user?: string;
    },
    location: Location
  ): Promise<Order> {
    const order = new this();

    order.quantity = quantity;
    order.orderType = orderType || OrderTypes.pizzas;
    order.snacks = quantity * ORDER_TYPE_TO_SNACKS[order.orderType];
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
