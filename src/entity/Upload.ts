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
import { UPLOAD_DECAY, UPLOAD_MAX, MEDIA_STATUS } from "./constants";
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

  @Column({ name: "raw_file_path", nullable: true })
  rawFilePath: string;

  @Column({
    name: "media_status",
    type: "enum",
    enum: ["none", "processing", "ready", "failed"],
    default: "none",
  })
  mediaStatus: "none" | "processing" | "ready" | "failed";

  @Column({ name: "processed_file_path", type: "jsonb", nullable: true })
  processedFilePath: Record<string, string | null> | null;

  @Column({ name: "exif_extracted", default: false })
  exifExtracted: boolean;

  @Column({ name: "exif_scrubbed", default: false })
  exifScrubbed: boolean;

  @Column({ name: "exif_data", type: "jsonb", nullable: true })
  exifData: Record<string, any> | null;

  @Column({
    name: "moderation_status",
    type: "enum",
    enum: ["pending", "clean", "flagged", "rejected"],
    default: "pending",
  })
  moderationStatus: "pending" | "clean" | "flagged" | "rejected";

  @Column({
    name: "moderation_score",
    type: "float",
    nullable: true,
  })
  moderationScore: number | null;

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
    upload.rawFilePath = upload.filePath;
    upload.mediaStatus = MEDIA_STATUS.PROCESSING;

    await upload.save();

    return [upload, false];
  }
}
