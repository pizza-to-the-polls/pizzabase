import {
  BaseEntity,
  Index,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  MoreThan,
} from "typeorm";
import { Location } from "./Location";
import { Order } from "./Order";
import { Truck } from "./Truck";
import { NormalAddress } from "../lib/validator";
import { REPORT_DECAY } from "../lib/constants";

@Entity({ name: "reports" })
export class Report extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "contact_info" })
  contactInfo: string;

  @Column({ name: "url" })
  @Index()
  reportURL: string;

  @ManyToOne((_type) => Location, (location) => location.reports, {
    eager: true,
    nullable: false,
  })
  @JoinColumn([{ name: "location_id", referencedColumnName: "id" }])
  @Index()
  location: Location;

  @ManyToOne((_type) => Order, (order) => order.reports, {
    eager: true,
  })
  @JoinColumn([{ name: "order_id", referencedColumnName: "id" }])
  @Index()
  order: Order;

  @ManyToOne((_type) => Truck, (truck) => truck.reports, {
    eager: true,
  })
  @JoinColumn([{ name: "truck_id", referencedColumnName: "id" }])
  @Index()
  truck: Truck;

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
    const { createdAt, id, reportURL } = this;

    return { createdAt, id, reportURL };
  }

  asJSONPrivate() {
    const { contactInfo, skippedAt } = this;

    return { ...this.asJSON(), contactInfo, skippedAt };
  }

  static async updateOpen(location: Location, set): Promise<void> {
    const query = {
      location,
      order: null,
      truck: null,
      skippedAt: null,
      createdAt: MoreThan(new Date(Number(new Date()) - REPORT_DECAY)),
    };

    if ((await this.count(query)) > 0) {
      this.createQueryBuilder().update(this).where(query).set(set).execute();
    }
  }

  static async createNewReport(
    contactInfo: string,
    reportURL: string,
    address: NormalAddress
  ): Promise<
    [
      Report,
      { isUniqueReport: boolean; isNewLocation: boolean; hasTruck: boolean }
    ]
  > {
    const report = new this();

    report.contactInfo = contactInfo;
    report.reportURL = reportURL;
    const [location, isNewLocation] = await Location.getOrCreateFromAddress(
      address
    );
    report.location = location;

    const truck = await location.activeTruck();
    if (!!truck) report.truck = truck;

    const reportExists = await this.findOne({
      where: { reportURL, location: report.location },
    });
    if (reportExists) report.order = reportExists.order;

    await report.save();

    return [
      report,
      { isUniqueReport: !reportExists, hasTruck: !!truck, isNewLocation },
    ];
  }
}
