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
  service: string; // "bluesky"

  @Column({ type: "text", name: "access_jwt" })
  accessJwt: string;

  @Column({ type: "text", name: "refresh_jwt" })
  refreshJwt: string;

  @Column()
  did: string;

  @Column()
  handle: string;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
