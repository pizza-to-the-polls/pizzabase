import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Location } from "./Location";
import { Report } from "./Report";

@Entity()
export class Order extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  cost!: number;

  @Column()
  pizzas!: number;

  @ManyToOne((type) => Location, (location) => location.orders, {
    eager: true,
    nullable: false,
  })
  location!: Location;

  @OneToMany((type) => Report, (report) => report.order)
  reports: Report;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;
}
