import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Report } from "./Report";
import { Order } from "./Order";
import { NormalAddress } from "../lib/geocoder";

@Entity()
export class Location {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name: string;

  @Column({ name: "full_address" })
  @Index({ unique: true })
  fullAddress!: string;

  @Column("point")
  @Index({ spatial: true })
  latlng!: string;

  @Column()
  address!: string;

  @Column()
  @Index()
  city!: string;

  @Column()
  @Index()
  state!: string;

  @Column({ length: 5 })
  @Index()
  zip!: string;

  @Column({ name: "is_approved", default: false })
  isApproved: boolean;

  @OneToMany((type) => Report, (report) => report.location)
  reports: Report[];

  @OneToMany((type) => Order, (order) => order.location)
  orders: Order[];

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;
}
