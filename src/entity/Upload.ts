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

  @Column({ name: "file_hash", unique: true, nullable: true })
  fileHash: string;

  static async createOrReject(
    ipAddress: string,
    {
      fileExt,
      normalizedAddress,
      fileHash,
    }: { fileExt: string; normalizedAddress: NormalAddress; fileHash: string }
  ): Promise<[Upload, boolean]> {
    const exists = await this.findOne({
      where: { fileHash },
    });
    if (exists) return [exists, true];

    const count = await this.count({
      where: {
        ipAddress,
        createdAt: MoreThan(new Date(Number(new Date()) - UPLOAD_DECAY)),
      },
    });

    if (count + 1 > UPLOAD_MAX) {
      throw new Error(
        "Whoops! You've had too many uploads recently - slow your roll"
      );
    }
    const upload = new this();

    const [location] = await Location.getOrCreateFromAddress(normalizedAddress);
    upload.location = location;
    const { city, state } = location;

    upload.ipAddress = ipAddress;
    upload.fileHash = fileHash;
    upload.filePath = `uploads/${city}-${state}-${
      uuidv4().split("-")[0]
    }.${fileExt}`
      .toLowerCase()
      .replace(/\s/g, "-");

    await upload.save();

    return [upload, false];
  }
}
