import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from "typeorm";
import { normalizePhone } from "../lib/validator/normalizeContact";

@Entity({ name: "banned_phone_numbers" })
export class BannedPhoneNumber extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "phone_number", unique: true })
  @Index({ unique: true })
  phoneNumber: string;

  @Column({ type: "text", nullable: true })
  reason: string;

  @Column({ name: "banned_by", nullable: true })
  bannedBy: string;

  @CreateDateColumn({ name: "banned_at" })
  bannedAt: Date;

  asJSON() {
    const { id, phoneNumber, reason, bannedBy, bannedAt } = this;
    return { id, phoneNumber, reason, bannedBy, bannedAt };
  }

  static async isBanned(phoneNumber: string): Promise<boolean> {
    const normalized = normalizePhone(phoneNumber);
    return (await this.count({ where: { phoneNumber: normalized } })) > 0;
  }
}
