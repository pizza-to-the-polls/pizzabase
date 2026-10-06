import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from "typeorm";
import { Link } from "./Link";

@Entity({ name: "link_clicks" })
export class LinkClick extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne((_type) => Link, { nullable: false })
  @JoinColumn({ name: "link_id" })
  @Index()
  link: Link;

  @Column({ name: "user_agent", nullable: true })
  userAgent: string | null;

  @Column({ name: "referer", nullable: true })
  referer: string | null;

  @CreateDateColumn({ name: "clicked_at", type: "timestamp with time zone" })
  clickedAt: Date;
}
