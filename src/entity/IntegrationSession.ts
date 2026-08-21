import {
  BaseEntity,
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "integration_sessions" })
export class IntegrationSession extends BaseEntity {
  @PrimaryColumn()
  service: string; // "bluesky", "threads", ...

  @Column({ type: "simple-json", name: "credentials" })
  credentials: Record<string, string>;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
