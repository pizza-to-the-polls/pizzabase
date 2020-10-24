import {
  BaseEntity,
  Index,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  MoreThan,
} from "typeorm";
import { NormalAddress } from "../lib/validator";
import { Location } from "./Location";
import { Report } from "./Report";
import { TRUCK_DECAY } from "./constants";

@Entity({ name: "trucks" })
export class Truck extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  @ManyToOne((_type) => Location, (location) => location.trucks, {
    eager: true,
    nullable: false,
  })
  @JoinColumn({ name: "location_id" })
  @Index()
  location: Location;

  @OneToMany((_type) => Report, (report) => report.truck)
  reports: Promise<Report[]>;

  @Column({ nullable: true })
  identifier: string | null;

  static async findAndCountActiveTrucks({
    take,
    skip,
  }: {
    take: number;
    skip: number;
  }): Promise<[Truck[], number]> {
    return this.findAndCount({
      where: {
        createdAt: MoreThan(new Date(Number(new Date()) - TRUCK_DECAY)),
      },
      take,
      skip,
    });
  }

  static async createForAddress(
    address: NormalAddress,
    identifier?: string,
    assignedBy?: string
  ): Promise<Truck> {
    const [location] = await Location.getOrCreateFromAddress(address);
    return await location.assignTruck(assignedBy, identifier);
  }

  static async createForLocation(
    location: Location,
    identifier?: string
  ): Promise<Truck> {
    const truck = new this();
    truck.location = location;
    truck.identifier = identifier || `${location.city}-${location.state}`;
    await truck.save();

    return truck;
  }
}
