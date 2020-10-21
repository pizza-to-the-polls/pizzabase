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
} from "typeorm";
import { Location } from "./Location";
import { Report } from "./Report";

@Entity()
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
  @JoinColumn([{ name: "location_id", referencedColumnName: "id" }])
  @Index()
  location: Location;

  @OneToMany((_type) => Report, (report) => report.truck)
  reports: Promise<Report[]>;

  @Column({ nullable: true })
  identifier: string | null;

  static async createForLocation(
    location: Location,
    identifier?: string
  ): Promise<Truck> {
    const truck = new this();
    truck.location = location;
    if (identifier) truck.identifier = identifier;
    await truck.save();

    return truck;
  }
}
