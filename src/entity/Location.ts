import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  Index,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  MoreThan,
} from "typeorm";
import { Truck } from "./Truck";
import { Report } from "./Report";
import { Order } from "./Order";
import { Upload } from "./Upload";
import { Action } from "./Action";
import { TRUCK_DECAY } from "./constants";
import { NormalAddress } from "../lib/validator";
import { toStateName } from "../lib/states";
import { truckEligibility } from "../lib/trucks";

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

  @Column()
  lat!: string;

  @Column()
  lng!: string;

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

  @OneToMany((_type) => Truck, (truck) => truck.location, {
    onDelete: "RESTRICT",
  })
  trucks: Promise<Truck[]>;

  @OneToMany((_type) => Upload, (upload) => upload.location, {
    onDelete: "RESTRICT",
  })
  uploads: Promise<Upload[]>;

  @ManyToOne((_type) => Location, {
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "canonical_id" })
  canonicalLocation: Promise<Location>;

  async activeTruck(): Promise<Truck> {
    return Truck.findOne({
      where: {
        location: this,
        createdAt: MoreThan(new Date(Number(new Date()) - TRUCK_DECAY)),
      },
    });
  }
  async hasTruckJSON(): Promise<{ [key: string]: string | boolean } | false> {
    const truck = await this.activeTruck();
    return truck ? truck.asJSON() : false;
  }
  async distributor(): Promise<Report | null> {
    const [openReport] = await Report.openReports(this);
    return (openReport?.canDistribute || 0) > 0 ? openReport : null;
  }
  async hasDistributor(): Promise<boolean> {
    return !!(await this.distributor());
  }

  async asJSON(showPrivate: boolean = false) {
    if (showPrivate) return await this.asJSONPrivate();

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
  async asJSONPrivate() {
    const canonicalLocation = await this.canonicalLocation;
    return {
      ...(await this.asJSON()),
      canonicalLocation: await canonicalLocation?.asJSON(),
      truckEligible: truckEligibility(this, new Date()),
      hasTruck: await this.hasTruckJSON(),
      pizzaDistributor: (await this.distributor())?.asJSONPrivate() || null,
    };
  }

  async openReports(): Promise<Report[]> {
    return await Report.openReports(this);
  }

  async validate(validatedBy?: string): Promise<void> {
    this.validatedAt = new Date();

    await this.save();
    await Action.log(this, "validated", validatedBy);
  }

  async skip(skippedBy?: string): Promise<void> {
    await Report.updateOpen(this, { skippedAt: new Date() });

    await Action.log(this, "skipped", skippedBy);
  }

  async assignTruck(assignedBy?: string, identifier?: string): Promise<Truck> {
    const truck = await Truck.createForLocation(this, identifier);
    await Report.updateOpen(this, { truck });

    await this.validate(assignedBy);
    await Action.log(this, "assigned truck", assignedBy);

    return truck;
  }

  async mergeInto(
    canonicalLocation: Location,
    mergedBy: string
  ): Promise<void> {
    const query = { location: this };
    const relations = [Report, Order, Truck];

    for (const Relation of relations) {
      if ((await Relation.count(query)) > 0) {
        await Relation.createQueryBuilder()
          .update(Relation)
          .where(query)
          .set({ location: canonicalLocation })
          .execute();
      }
    }

    this.canonicalLocation = canonicalLocation;
    this.validatedAt = null;
    await this.save();
    await Action.log(this, `merged into ${canonicalLocation.id}`, mergedBy);
    await Action.log(canonicalLocation, `absorbed ${this.id}`, mergedBy);
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
    location.lat = `${latitude}`;
    location.lng = `${longitude}`;

    await location.save();

    return location;
  }
  static async getOrCreateFromAddress(
    normalAddress: NormalAddress
  ): Promise<[Location, boolean]> {
    const { fullAddress } = normalAddress;
    const exists = await this.findOne({ where: { fullAddress } });

    if (exists) {
      return [(await exists.canonicalLocation) || exists, false];
    }

    const location = await this.createFromAddress(normalAddress);

    return [location, true];
  }
}
