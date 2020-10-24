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
import { REPORT_DECAY } from "./constants";
import { NormalAddress } from "../lib/validator";

const OPEN_QUERY = {
  order: null,
  truck: null,
  skippedAt: null,
  createdAt: MoreThan(new Date(Number(new Date()) - REPORT_DECAY)),
};

@Entity({ name: "reports" })
export class Report extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "contact_info" })
  contactInfo: string;

  @Column({ name: "contact_first_name", nullable: true })
  contactFirstName: string;

  @Column({ name: "contact_last_name", nullable: true })
  contactLastName: string;

  @Column({ name: "wait_time", nullable: true })
  waitTime: string;

  /*
    NOTE: This is to prevent an issue where true is being cast as 1 on save
    and - which works with psql adapter but fails with prod's aurora
    serverless adapter - failing with the following exception:

      > type boolean but expression is of type bigint

    It's stupid to store as an int but here we are
  */
  @Column({ name: "can_distribute", default: 0 })
  canDistribute: number;

  @Column({ name: "url" })
  @Index()
  reportURL: string;

  @ManyToOne((_type) => Location, (location) => location.reports, {
    eager: true,
    nullable: false,
  })
  @JoinColumn({ name: "location_id" })
  @Index()
  location: Location;

  @ManyToOne((_type) => Order, (order) => order.reports, {
    eager: true,
  })
  @JoinColumn({ name: "order_id" })
  @Index()
  order: Order;

  @ManyToOne((_type) => Truck, (truck) => truck.reports, {
    eager: true,
  })
  @JoinColumn({ name: "truck_id" })
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

  asJSON(showPrivate: boolean = false) {
    if (showPrivate) return this.asJSONPrivate();

    const { createdAt, id, reportURL, waitTime } = this;

    return { createdAt, id, reportURL, waitTime };
  }

  asJSONPrivate() {
    const { contactInfo, canDistribute } = this;

    return {
      ...this.asJSON(),
      contactInfo,
      canDistribute: canDistribute > 0,
    };
  }

  static async openReports(location: Location): Promise<Report[]> {
    return await this.find({
      where: {
        location,
        ...OPEN_QUERY,
      },
      order: { canDistribute: "DESC", id: "ASC" },
    });
  }
  static async updateOpen(location: Location, set): Promise<void> {
    const query = {
      location,
      ...OPEN_QUERY,
    };

    if ((await this.count(query)) > 0) {
      this.createQueryBuilder().update(this).where(query).set(set).execute();
    }
  }

  static async createNewReport(
    contactInfo: string,
    reportURL: string,
    address: NormalAddress,
    {
      waitTime,
      contactFirstName,
      contactLastName,
      canDistribute,
    }: {
      waitTime?: string;
      canDistribute?: boolean;
      contactFirstName?: string;
      contactLastName?: string;
    } = {}
  ): Promise<
    [
      Report,
      {
        willReceive: boolean;
        isUnique: boolean;
        isNewLocation: boolean;
        hasTruck: boolean;
        alreadyOrdered: boolean;
      }
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

    const willReceive = !(await location.hasDistributor()) && !!canDistribute;
    report.canDistribute = canDistribute ? 1 : 0;
    report.waitTime = waitTime;
    report.contactFirstName = contactFirstName;
    report.contactLastName = contactLastName;

    const reportExists = await this.findOne({
      where: { reportURL, location: report.location },
    });
    if (reportExists) report.order = reportExists.order;

    await report.save();

    return [
      report,
      {
        isUnique: !reportExists,
        hasTruck: !!truck,
        willReceive,
        isNewLocation,
        alreadyOrdered: !!report.order,
      },
    ];
  }
}
