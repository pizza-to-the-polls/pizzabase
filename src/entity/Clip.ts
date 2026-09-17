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

const ALL_STATUSES: ClipStatus[] = [
  "queued",
  "rendering",
  "ready",
  "approved",
  "published",
  "rejected",
];

const VALID_TRANSITIONS: ReadonlyMap<ClipStatus, Set<ClipStatus>> = (() => {
  const m = new Map<ClipStatus, Set<ClipStatus>>();
  m.set("queued", new Set(["rendering"]));
  m.set("rendering", new Set(["ready", "rejected"]));
  m.set("ready", new Set(["approved", "rejected"]));
  m.set("approved", new Set(["published", "rejected"]));
  m.set("published", new Set(["rejected"]));
  m.set("rejected", new Set(["queued"]));
  return m;
})();

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
    enum: ALL_STATUSES,
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
   * Returns true when a transition from `from` to `to` is valid.
   *
   * Valid transitions:
   *   queued     → rendering
   *   rendering  → ready
   *   rendering  → rejected  (failure path; set failureReason separately)
   *   ready      → approved
   *   ready      → rejected
   *   approved   → published
   *   approved   → rejected
   *   published  → rejected  (take-down)
   *   rejected   → queued    (re-render loop)
   *
   * Self-transitions (from == to) and any pair not listed above return false.
   */
  static canTransition(from: ClipStatus, to: ClipStatus): boolean {
    const allowed = VALID_TRANSITIONS.get(from);
    return allowed ? allowed.has(to) : false;
  }

  /** Public shape for API responses and cross-service contracts. */
  asJSON(): {
    id: number;
    status: ClipStatus;
    uploadId: number;
    outputPaths: Record<string, string> | null;
    kit: Record<string, unknown> | null;
    approvedBy: string | null;
    approvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id: this.id,
      status: this.status,
      uploadId: this.upload.id,
      outputPaths: this.outputPaths,
      kit: this.kit,
      approvedBy: this.approvedBy,
      approvedAt: this.approvedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
