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
  IsNull,
  Not,
} from "typeorm";
import { Location } from "./Location";
import { Order } from "./Order";
import { Truck } from "./Truck";
import { Upload } from "./Upload";
import { REPORT_DECAY } from "./constants";
import { NormalAddress } from "../lib/validator";
import { normalizePhone } from "../lib/validator/normalizeContact";

const OPEN_QUERY = {
  order: IsNull(),
  truck: IsNull(),
  skippedAt: IsNull(),
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

  @Column({ name: "contact_role", nullable: true })
  contactRole: string;

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

  @ManyToOne(() => Upload, { nullable: true })
  @JoinColumn({ name: "upload_id" })
  @Index()
  upload: Upload | null;

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
    const {
      contactInfo,
      contactFirstName,
      contactLastName,
      contactRole,
      canDistribute,
    } = this;

    return {
      ...this.asJSON(),
      contactInfo,
      contactFirstName,
      contactLastName,
      contactRole,
      canDistribute: canDistribute > 0,
    };
  }

  static async allReports(where): Promise<Report[]> {
    return await this.find({
      where,
      order: { canDistribute: "DESC", createdAt: "ASC" },
    });
  }
  static async openReports(location: Location): Promise<Report[]> {
    return await this.allReports({
      location: { id: location.id },
      ...OPEN_QUERY,
    });
  }

  /**
   * Find the newest fulfilled report (pizza ordered or truck assigned) made
   * within the last `windowDays` by a sender phone number. Used by the MMS
   * reply workflow to resolve which report an inbound media message is
   * replying about.
   *
   * NOTE: contactInfo is matched against the normalized (digits/+ only) form
   * of the input phone. Reports submitted via the web flow store whatever
   * formatting the user typed (e.g. "555-234-2345"), so only reports whose
   * contactInfo is stored E.164-ish will match here today.
   */
  static async findRecentFulfilledByPhone(
    phone: string,
    windowDays = 30,
  ): Promise<Report | null> {
    const normalized = normalizePhone(phone);
    const days = Number(process.env.MMS_MATCH_WINDOW_DAYS) || windowDays;
    const since = new Date(Number(new Date()) - days * 24 * 60 * 60 * 1000);

    const report = await this.findOne({
      where: [
        {
          contactInfo: normalized,
          order: Not(IsNull()),
          createdAt: MoreThan(since),
        },
        {
          contactInfo: normalized,
          truck: Not(IsNull()),
          createdAt: MoreThan(since),
        },
      ],
      order: { createdAt: "DESC" },
    });

    return report ?? null;
  }
  static async updateOpen(location: Location, set): Promise<void> {
    const query = {
      location: { id: location.id },
      ...OPEN_QUERY,
    };

    if ((await this.count({ where: query })) > 0) {
      await this.createQueryBuilder()
        .update(this)
        .where(query)
        .set(set)
        .execute();
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
      contactRole,
      canDistribute,
      upload,
    }: {
      waitTime?: string;
      canDistribute?: boolean;
      contactFirstName?: string;
      contactLastName?: string;
      contactRole?: string;
      upload?: Upload | null;
    } = {},
  ): Promise<
    [
      Report,
      {
        willReceive: boolean;
        isUnique: boolean;
        isNewLocation: boolean;
        hasTruck: boolean;
        alreadyOrdered: boolean;
      },
    ]
  > {
    const report = new this();

    report.contactInfo = contactInfo;
    report.reportURL = reportURL;
    const [location, isNewLocation] =
      await Location.getOrCreateFromAddress(address);
    report.location = location;

    const truck = await location.activeTruck();
    if (truck) report.truck = truck;

    const willReceive = !(await location.hasDistributor()) && !!canDistribute;
    report.canDistribute = canDistribute ? 1 : 0;
    report.waitTime = waitTime ?? null;
    report.contactFirstName = contactFirstName ?? null;
    report.contactLastName = contactLastName ?? null;
    report.contactRole = contactRole ?? null;
    if (upload) report.upload = upload;

    const reportExists =
      !isNewLocation &&
      (await this.findOne({
        where: { reportURL, location: { id: location.id } },
      }));
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
