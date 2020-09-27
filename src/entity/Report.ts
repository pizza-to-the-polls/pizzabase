import {
  BaseEntity,
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
import { NormalAddress } from "../lib/validator";

@Entity()
export class Report extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "contact_info" })
  contactInfo!: string;

  @Column({ name: "url" })
  @Index()
  reportURL!: string;

  @ManyToOne((_type) => Location, (location) => location.reports, {
    eager: true,
    nullable: false,
  })
  location!: Location;

  @ManyToOne((_type) => Order, (order) => order.reports, { eager: true })
  order: Order;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  static async createNewReport(
    contactInfo: string,
    reportURL: string,
    address: NormalAddress
  ): Promise<Report> {
    const report = new this();

    report.contactInfo = contactInfo;
    report.reportURL = reportURL;
    report.location = await Location.getOrCreateFromAddress(address);

    await report.save();

    return report;
  }
}
