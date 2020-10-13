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

@Entity({ name: "reports" })
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

  @Column({
    name: "skipped_at",
    type: "timestamp with time zone",
    nullable: true,
  })
  skippedAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  asJSON() {
    const { createdAt, id, reportURL, contactInfo } = this;

    return { createdAt, id, reportURL, contactInfo };
  }

  asJSONPrivate() {
    const { contactInfo, skippedAt } = this;

    return { ...this.asJSON(), contactInfo, skippedAt };
  }

  static async bulkUpdate(query, set): Promise<void> {
    this.createQueryBuilder().update(this).where(query).set(set).execute();
  }

  static async createNewReport(
    contactInfo: string,
    reportURL: string,
    address: NormalAddress
  ): Promise<[Report, { isUniqueReport: boolean; isNewLocation: boolean }]> {
    const report = new this();

    report.contactInfo = contactInfo;
    report.reportURL = reportURL;
    const [location, isNewLocation] = await Location.getOrCreateFromAddress(
      address
    );
    report.location = location;

    const reportExists = await this.findOne({
      where: { reportURL, location: report.location },
    });
    if (reportExists) report.order = reportExists.order;

    await report.save();

    return [report, { isUniqueReport: !reportExists, isNewLocation }];
  }
}
