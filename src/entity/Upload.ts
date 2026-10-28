import {
  BaseEntity,
  Index,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  MoreThan,
} from "typeorm";
import { Clip } from "./Clip";
import { Location } from "./Location";
import { Report } from "./Report";
import { NormalAddress } from "../lib/validator";
import { UPLOAD_DECAY, UPLOAD_MAX } from "./constants";
import { v4 as uuidv4 } from "uuid";

export type MediaStatus = "none" | "processing" | "ready" | "failed";
export type ModerationStatus = "pending" | "clean" | "flagged" | "rejected";
export type UploadSource = "web" | "mms";

@Entity({ name: "uploads" })
export class Upload extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  // Nullable for orphan MMS media (issue #341): senders with no matched
  // recent report still get their media stored — just without a location.
  // Web uploads and matched MMS replies always carry a location.
  @ManyToOne((_type) => Location, (location) => location.reports, {
    eager: true,
    nullable: true,
  })
  @JoinColumn([{ name: "location_id", referencedColumnName: "id" }])
  @Index()
  location: Location | null;

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
    enumName: "media_status",
    default: "none",
  })
  mediaStatus: MediaStatus;

  @Column({ name: "processed_file_path", type: "jsonb", nullable: true })
  processedFilePath: Record<string, string> | null;

  @Column({ name: "exif_extracted", default: false })
  exifExtracted: boolean;

  @Column({ name: "exif_scrubbed", default: false })
  exifScrubbed: boolean;

  @Column({ name: "exif_data", type: "jsonb", nullable: true })
  exifData: Record<string, unknown> | null;

  @Column({
    name: "moderation_status",
    type: "enum",
    enum: ["pending", "clean", "flagged", "rejected"],
    enumName: "moderation_status",
    default: "pending",
  })
  moderationStatus: ModerationStatus;

  @Column({ name: "moderation_score", type: "float", nullable: true })
  moderationScore: number | null;

  @Column({ name: "raw_bucket", type: "varchar", nullable: true })
  rawBucket: string | null;

  @Column({ name: "sightengine_score", type: "float", nullable: true })
  sightengineScore: number | null;

  @OneToMany((_type) => Clip, (clip) => clip.upload)
  clips: Promise<Clip[]>;

  @Column({ name: "failure_reason", type: "varchar", nullable: true })
  failureReason: string | null;

  @Column({
    name: "source",
    type: "enum",
    enum: ["web", "mms"],
    enumName: "upload_source",
    default: "web",
  })
  source: UploadSource;

  // MMS direction: one report can have many inbound text-message media
  // uploads. (reports.upload_id is the reverse direction for web uploads.)
  @ManyToOne((_type) => Report, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "report_id" })
  @Index()
  report: Report | null;

  // Normalized E.164 sender phone for MMS-origin uploads.
  @Column({ name: "source_phone", type: "varchar", nullable: true })
  sourcePhone: string | null;

  // Twilio message SID for MMS-origin uploads — join key for Retool.
  @Column({ name: "message_sid", type: "varchar", length: 64, nullable: true })
  @Index()
  messageSid: string | null;

  // Announce-once claim for the Zapier media hooks (issue #349): NULL = the
  // notify slot is unclaimed, set = some invocation already consumed it.
  // zapNewUpload / zapNewMmsUpload compare-and-set this column so duplicate
  // S3 events and client PUT retries can never double-post the feed/internal
  // channels. Shared by both hooks — they are mutually exclusive per upload
  // (web vs mms source), so one column enforces "at most once per row".
  @Column({
    name: "zap_notified_at",
    type: "timestamp with time zone",
    nullable: true,
  })
  zapNotifiedAt: Date | null;

  static async createOrReject(
    ipAddress: string,
    {
      fileExt,
      normalizedAddress,
      fileHash,
    }: { fileExt: string; normalizedAddress: NormalAddress; fileHash: string },
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
        "Whoops! You've had too many uploads recently - slow your roll",
      );
    }
    const upload = new this();

    const [location] = await Location.getOrCreateFromAddress(normalizedAddress);
    upload.location = location;
    const { city, state } = location;

    upload.ipAddress = ipAddress;
    upload.fileHash = fileHash;
    upload.sightengineScore = null;
    const generatedPath = `uploads/${city}-${state}-${
      uuidv4().split("-")[0]
    }.${fileExt}`
      .toLowerCase()
      .replace(/\s/g, "-");
    upload.filePath = generatedPath;
    upload.rawFilePath = generatedPath;
    upload.rawBucket = process.env.RAW_UPLOADS_BUCKET || "raw.polls.pizza";
    upload.mediaStatus = "processing";

    await upload.save();

    return [upload, false];
  }

  static async createFromMms(
    report: Report | null,
    {
      fileExt,
      fileHash,
      sourcePhone,
      messageSid, // new optional param
    }: {
      fileExt: string;
      fileHash: string;
      sourcePhone: string;
      messageSid?: string;
    },
  ): Promise<[Upload, boolean]> {
    const exists = await this.findOne({
      where: { fileHash },
    });
    if (exists) return [exists, true];

    // Rate-limit keyed on the sender phone rather than IP; ipAddress is set
    // to a fixed marker so MMS counts can never collide with web uploads.
    const count = await this.count({
      where: {
        ipAddress: "mms",
        sourcePhone,
        createdAt: MoreThan(new Date(Number(new Date()) - UPLOAD_DECAY)),
      },
    });

    if (count + 1 > UPLOAD_MAX) {
      throw new Error(
        "Whoops! You've had too many uploads recently - slow your roll",
      );
    }
    const upload = new this();

    if (report) {
      // Matched path: link the report's location and keep the city/state
      // file-path scheme.
      upload.location = report.location;
      const { city, state } = report.location;
      const generatedPath = `uploads/${city}-${state}-${
        uuidv4().split("-")[0]
      }.${fileExt}`
        .toLowerCase()
        .replace(/\s/g, "-");
      upload.filePath = generatedPath;
      upload.rawFilePath = generatedPath;
    } else {
      // Orphan path (issue #341): no matched report → no location. The file
      // path can't carry city/state, so use a city/state-free scheme.
      upload.location = null;
      const generatedPath = `uploads/mms-${uuidv4().split("-")[0]}.${fileExt}`
        .toLowerCase()
        .replace(/\s/g, "-");
      upload.filePath = generatedPath;
      upload.rawFilePath = generatedPath;
    }

    upload.ipAddress = "mms";
    upload.sourcePhone = sourcePhone;
    upload.fileHash = fileHash;
    upload.sightengineScore = null;
    upload.rawBucket = process.env.RAW_UPLOADS_BUCKET || "raw.polls.pizza";
    upload.mediaStatus = "processing";
    upload.source = "mms";
    upload.report = report;
    upload.messageSid = messageSid ?? null;

    await upload.save();

    return [upload, false];
  }
}
