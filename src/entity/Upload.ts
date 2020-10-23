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
import { NormalAddress } from "../lib/validator";
import { UPLOAD_DECAY, UPLOAD_MAX } from "./constants";
import { v4 as uuidv4 } from "uuid";

@Entity({ name: "uploads" })
export class Upload extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  @ManyToOne((_type) => Location, (location) => location.reports, {
    eager: true,
    nullable: false,
  })
  @JoinColumn([{ name: "location_id", referencedColumnName: "id" }])
  @Index()
  location: Location;

  @Column({ name: "ip_address" })
  @Index()
  ipAddress: string;

  @Column({ name: "file_path", unique: true })
  filePath: string;

  static async createOrRateLimit(
    ipAddress: string,
    {
      fileExt,
      normalizedAddress,
    }: { fileExt: string; normalizedAddress: NormalAddress }
  ): Promise<Upload> {
    const count = await this.count({
      where: {
        ipAddress,
        createdAt: MoreThan(new Date(Number(new Date()) - UPLOAD_DECAY)),
      },
    });

    if (count + 1 > UPLOAD_MAX) {
      throw new Error("Too many uploads");
    }
    const upload = new this();

    const [location] = await Location.getOrCreateFromAddress(normalizedAddress);
    upload.location = location;
    const { city, state } = location;

    upload.ipAddress = ipAddress;
    upload.filePath = `uploads/${city}-${state}-${
      uuidv4().split("-")[0]
    }.${fileExt}`.toLowerCase();

    await upload.save();

    return upload;
  }
}
