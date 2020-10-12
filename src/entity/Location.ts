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
import { Action } from "./Action";
import { NormalAddress } from "../lib/validator";
import { toStateName } from "../lib/states";

@Entity({ name: "locations" })
export class Location extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  @Column({ name: "full_address", unique: true })
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

  @Column({
    name: "validated_at",
    type: "timestamp with time zone",
    nullable: true,
  })
  validatedAt: Date | null;

  @OneToMany((_type) => Report, (report) => report.location, {
    onDelete: "RESTRICT",
  })
  reports: Promise<Report[]>;

  @OneToMany((_type) => Order, (order) => order.location, {
    onDelete: "RESTRICT",
  })
  orders: Promise<Order[]>;

  asJSON() {
    const {
      city,
      state,
      address,
      zip,
      fullAddress,
      lat,
      lng,
      id,
      validatedAt,
    } = this;
    return {
      city,
      state,
      zip,
      address,
      fullAddress,
      lat,
      lng,
      id,
      validatedAt,
      stateName: toStateName(state),
    };
  }

  async validate(validatedBy?: string): Promise<Report[]> {
    this.validatedAt = new Date();

    await this.save();
    await Action.log(this, "validated", validatedBy);

    return await await Report.find({ where: { location: this, order: null } });
  }

  async skip(validatedBy?: string): Promise<void> {
    await Report.bulkUpdate(
      { location: this, order: null, skippedAt: null },
      { skippedAt: new Date() }
    );

    await Action.log(this, "skipped", validatedBy);
  }

  static async fidByIdOrFullAddress(
    idOrAddress: string
  ): Promise<Location | null> {
    return this.findOne({
      where: idOrAddress.match(/[a-z]/g)
        ? { fullAddress: idOrAddress.replace(/\+|\%20/g, " ") }
        : { id: Number(idOrAddress) },
    });
  }

  static async createFromAddress(
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

    const location = new this();

    location.fullAddress = fullAddress;
    location.address = address;
    location.zip = zip;
    location.city = city;
    location.state = state;
    location.lat = latitude;
    location.lng = longitude;

    await location.save();

    return location;
  }
  static async getOrCreateFromAddress(
    normalAddress: NormalAddress
  ): Promise<[Location, boolean]> {
    const { fullAddress } = normalAddress;
    const exists = await this.findOne({ where: { fullAddress } });

    if (exists) return [exists, false];

    const location = await this.createFromAddress(normalAddress);

    return [location, true];
  }
}
