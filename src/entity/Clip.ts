import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import { Upload } from "./Upload";

export type ClipStatus =
  "queued" | "rendering" | "ready" | "approved" | "published" | "rejected";

const CLIP_STATUS_VALUES: ClipStatus[] = [
  "queued",
  "rendering",
  "ready",
  "approved",
  "published",
  "rejected",
];

const TRANSITIONS: Record<ClipStatus, ClipStatus[]> = {
  queued: ["rendering"],
  rendering: ["ready", "rejected"],
  ready: ["approved", "rejected"],
  approved: ["published", "rejected"],
  published: [],
  rejected: ["queued"],
};

@Entity({ name: "clips" })
export class Clip extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne((_type) => Upload, (upload) => upload.clips, { nullable: false })
  @JoinColumn({ name: "upload_id" })
  @Index()
  upload: Upload;

  @Column({
    name: "status",
    type: "enum",
    enum: CLIP_STATUS_VALUES,
    enumName: "clip_status",
    default: "queued",
  })
  status: ClipStatus;

  @Column({ name: "failure_reason", nullable: true })
  failureReason: string | null;

  @Column({ name: "output_paths", type: "jsonb", nullable: true })
  outputPaths: Record<string, string> | null;

  @Column({ name: "kit", type: "jsonb", nullable: true })
  kit: Record<string, unknown> | null;

  @Column({ name: "publish_log", type: "jsonb", nullable: true })
  publishLog: Array<Record<string, unknown>> | null;

  @Column({ name: "approved_by", nullable: true })
  approvedBy: string | null;

  @Column({
    name: "approved_at",
    type: "timestamp with time zone",
    nullable: true,
  })
  approvedAt: Date | null;

  /**
   * Returns true when the requested status transition is valid.
   * Callers should check this before updating status and handle
   * the rejection themselves (throw, log, etc.).
   */
  static canTransition(from: ClipStatus, to: ClipStatus): boolean {
    const allowed = TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Public shape exposed to API consumers and partner agents.
   * Excludes sensitive / operational fields: failureReason,
   * publishLog, approval metadata.
   */
  asJSON(): Record<string, unknown> {
    return {
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      status: this.status,
      outputPaths: this.outputPaths,
      kit: this.kit
        ? {
            caption: (this.kit as Record<string, unknown>).caption,
            hashtags: (this.kit as Record<string, unknown>).hashtags,
            shortUrlSlug: (this.kit as Record<string, unknown>).shortUrlSlug,
          }
        : null,
    };
  }
}
