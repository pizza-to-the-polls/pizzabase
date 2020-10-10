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

  @Column("double precision")
  lat!: number;

  @Column("double precision")
  lng!: number;

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

  @OneToMany((_type) => Report, (report) => report.location, {
    onDelete: "RESTRICT",
  })
  reports: Report[];

  @OneToMany((_type) => Order, (order) => order.location, {
    onDelete: "RESTRICT",
  })
  orders: Order[];

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  static async fidByIdOrFullAddress(
    idOrAddress: string
  ): Promise<Location | null> {
    return Location.findOne({
      where: idOrAddress.match(/[a-z]/g)
        ? { fullAddress: idOrAddress.replace(/\+|\%20/g, " ") }
        : { id: Number(idOrAddress) },
    });
  }

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
    loc.lat = latitude;
    loc.lng = longitude;

    await loc.save();

    return loc;
  }
}
