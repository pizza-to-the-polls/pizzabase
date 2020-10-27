import {
  BaseEntity,
  PrimaryGeneratedColumn,
  Entity,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Column,
} from "typeorm";

@Entity({ name: "donations" })
export class Donation extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  @Column({
    name: "cancelled_at",
    type: "timestamp with time zone",
    nullable: true,
  })
  cancelledAt;

  @Column()
  @Index()
  email: string;

  @Column({ type: "double precision", name: "amount_gross" })
  amountGross: number;

  @Column({ type: "double precision" })
  amount: number;

  @Column({ name: "stripe_id", unique: true })
  @Index()
  stripeId: string;

  @Column({ nullable: true })
  referrer: string;

  @Column({ name: "cancel_note", nullable: true })
  cancelNote: string;

  @Column({ name: "postal_code", nullable: true })
  postalCode: string;

  @Column({ default: "https://polls.pizza" })
  url: string;

  static async succeedCharge({
    id,
    amount,
    billing_details: { email, postal_code },
    metadata: { referrer },
  }: {
    id: string;
    amount: number;
    metadata: { referrer?: string };
    billing_details: { email: string; postal_code: string };
  }): Promise<Donation> {
    const donation = new Donation();
    donation.amountGross = amount / 100;
    donation.amount = Math.floor(amount * (1 - 0.029) - 0.3 * 100) / 100;
    donation.email = email;
    donation.stripeId = id;
    donation.postalCode = postal_code;
    donation.referrer = referrer;

    await donation.save();

    return donation;
  }

  static async failCharge(
    note: string,
    { id }: { id: string }
  ): Promise<Donation | null> {
    const donation = await this.findOne({ where: { stripeId: id } });

    if (!donation) return null;

    donation.cancelledAt = new Date();
    donation.cancelNote = note;

    await donation.save();

    return donation;
  }
}
