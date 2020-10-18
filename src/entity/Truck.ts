import {
  BaseEntity,
  Index,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Location } from "./Location";

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
}
