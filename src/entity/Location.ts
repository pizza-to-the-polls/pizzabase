import {
  BaseEntity,
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
import { NormalAddress } from "../lib/validator";

@Entity()
export class Location extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

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

  @OneToMany((type) => Report, (report) => report.location, {
    onDelete: "RESTRICT",
  })
  reports: Report[];

  @OneToMany((type) => Order, (order) => order.location, {
    onDelete: "RESTRICT",
  })
  orders: Order[];

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  static async getOrCreateFromAddress(
    normalAddress: NormalAddress
  ): Promise<Location> {
    const {
      fullAddress,
      address,
      city,
      state,
      zip,
      latitude,
      longitude,
    } = normalAddress;
    const exists = await this.findOne({ where: { fullAddress } });

    if (exists) return exists;

    const loc = new this();

    loc.fullAddress = fullAddress;
    loc.address = address;
    loc.zip = zip;
    loc.city = city;
    loc.state = state;
    loc.latlng = `${latitude}, ${longitude}`;

    await loc.save();

    return loc;
  }
}
