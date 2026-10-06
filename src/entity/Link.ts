import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from "typeorm";

const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SLUG_LENGTH = 5;

@Entity({ name: "links" })
export class Link extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "slug", unique: true })
  slug: string;

  @Column({ name: "target_url" })
  targetUrl: string;

  @Column({ name: "campaign_tag" })
  @Index()
  campaignTag: string;

  // FK to clips(id), enforced in migration. Plain column keeps parallel work
  // unblocked — no TypeORM relationship import of Clip required.
  @Column({ name: "clip_id", nullable: true })
  clipId: number | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  /**
   * Generate a random 5-character base62 slug (a-zA-Z0-9).
   * ~916M possible values — birthday collision probability < 0.1% at 1K slugs.
   */
  static generateSlug(): string {
    let slug = "";
    for (let i = 0; i < SLUG_LENGTH; i++) {
      slug += BASE62[Math.floor(Math.random() * 62)];
    }
    return slug;
  }

  /**
   * Create a Link with a unique slug, retrying on collision.
   * Uses up to maxRetries attempts before surfacing the error.
   */
  static async createWithSlug(
    params: {
      targetUrl: string;
      campaignTag: string;
      clipId?: number | null;
    },
    maxRetries = 10,
  ): Promise<Link> {
    const { targetUrl, campaignTag, clipId } = params;
    let attempts = 0;

    while (attempts < maxRetries) {
      const link = new Link();
      link.slug = Link.generateSlug();
      link.targetUrl = targetUrl;
      link.campaignTag = campaignTag;
      link.clipId = clipId ?? null;

      try {
        await link.save();
        return link;
      } catch (e) {
        // Retry on unique-constraint violation (PG code 23505)
        const code = (e as any)?.code || (e as any)?.driverError?.code;
        if (code === "23505") {
          attempts++;
          continue;
        }
        throw e;
      }
    }

    throw new Error(
      `Failed to generate unique slug after ${maxRetries} attempts`,
    );
  }
}
