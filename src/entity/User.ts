import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Known trusted users — partner-report submitters (JWT login) and the
 * people behind trusted API submissions.
 *
 * Populated via the API-key-protected CRUD endpoints (UsersController,
 * GET/POST/PUT/DELETE /users) so Pizza Eagle can add people by request
 * (Lee/Nina/Scott ask in Slack → pizza-eagle POSTs). reports.trusted_by
 * references this table.
 */
@Entity({ name: "users" })
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  @Index({ unique: true })
  email: string;

  @Column({ name: "first_name", nullable: true })
  firstName: string | null;

  @Column({ nullable: true })
  organization: string | null;

  @Column({ default: false })
  admin: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt;

  static async findUserByEmail(email?: string): Promise<User | null> {
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized) return null;
    return await this.findOne({ where: { email: normalized } });
  }

  asJSON() {
    const { id, email, firstName, organization, admin, createdAt } = this;
    return { id, email, firstName, organization, admin, createdAt };
  }
}
