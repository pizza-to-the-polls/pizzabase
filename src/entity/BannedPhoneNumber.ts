import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  In,
} from "typeorm";
import {
  normalizePhone,
  phoneVariants,
} from "../lib/validator/normalizeContact";

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
    return (
      (await this.count({
        where: { phoneNumber: In(phoneVariants(phoneNumber)) },
      })) > 0
    );
  }

  static async findByIdOrPhoneNumber(
    idOrPhoneNumber: string,
  ): Promise<BannedPhoneNumber | null> {
    // SERIAL ids are small; phone numbers are 10+ digits. Only treat short
    // all-digit values as ids so 10-digit phone numbers never overflow integer.
    if (/^\d{1,7}$/.test(idOrPhoneNumber)) {
      const byId = await this.findOne({
        where: { id: Number(idOrPhoneNumber) },
      });
      if (byId) return byId;
    }

    return this.findOne({
      where: { phoneNumber: normalizePhone(idOrPhoneNumber) },
    });
  }
}
