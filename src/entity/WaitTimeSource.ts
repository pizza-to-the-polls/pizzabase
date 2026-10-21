import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type WaitTimeScope = "statewide" | "county" | "location";
export type SourceType = "link" | "api" | "iframe";

@Entity({ name: "wait_time_sources" })
export class WaitTimeSource extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @Column({
    type: "enum",
    enum: ["statewide", "county", "location"],
    enumName: "wait_time_scope",
    nullable: false,
  })
  scope!: WaitTimeScope;

  @Column({ type: "char", length: 2, nullable: false })
  @Index()
  state!: string;

  // Required when scope = 'county', null otherwise (enforced by CHECK constraint)
  @Column({ nullable: true })
  county: string | null;

  // Required when scope = 'location', null otherwise (enforced by CHECK constraint).
  // Deliberately no TypeORM relation: the matching query only needs the raw ID,
  // and a ManyToOne would eagerly load Location on every read.
  @Column({ name: "location_id", type: "int", nullable: true })
  @Index()
  locationId: number | null;

  @Column({ nullable: false })
  url!: string;

  @Column({
    name: "source_type",
    type: "enum",
    enum: ["link", "api", "iframe"],
    enumName: "source_type",
    default: "link",
  })
  sourceType!: SourceType;

  @Column({ name: "display_label", nullable: true })
  displayLabel: string | null;

  @Column({ nullable: true })
  notes: string | null;

  // Phase 2: populated by agentic discovery ('manual', 'agent_v0', 'agent_v1', ...)
  @Column({ name: "discovery_method", nullable: true })
  discoveryMethod: string | null;

  // Phase 2: 0-1 confidence score
  @Column({ name: "discovery_confidence", type: "float", nullable: true })
  discoveryConfidence: number | null;

  @Column({ name: "is_active", default: true })
  @Index()
  isActive!: boolean;

  @Column({
    name: "last_verified_at",
    type: "timestamp with time zone",
    nullable: true,
  })
  lastVerifiedAt: Date | null;

  @Column({
    name: "last_success_at",
    type: "timestamp with time zone",
    nullable: true,
  })
  lastSuccessAt: Date | null;

  @Column({
    name: "last_error_at",
    type: "timestamp with time zone",
    nullable: true,
  })
  lastErrorAt: Date | null;

  @Column({ name: "last_error_message", nullable: true })
  lastErrorMessage: string | null;

  asJSON() {
    return {
      id: this.id,
      scope: this.scope,
      state: this.state,
      county: this.county,
      locationId: this.locationId,
      url: this.url,
      sourceType: this.sourceType,
      displayLabel: this.displayLabel,
      notes: this.notes,
      discoveryMethod: this.discoveryMethod,
      discoveryConfidence: this.discoveryConfidence,
      isActive: this.isActive,
      lastVerifiedAt: this.lastVerifiedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
