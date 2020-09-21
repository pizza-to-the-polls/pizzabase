import {
  Index,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Location } from "./Location";
import { Order } from "./Order";

@Entity()
export class Report {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index({ unique: true })
  resource!: string;

  @Column({ name: "contact_info" })
  contactInfo!: string;

  @ManyToOne((type) => Location, (location) => location.reports)
  location!: Location;

  @ManyToOne((type) => Order, (order) => order.reports)
  order: Order;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;
}
