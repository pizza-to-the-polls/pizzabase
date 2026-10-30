import {
  BaseEntity,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

/**
 * feedflag/observation@1 — normalized observation records from the
 * feedflag social-feed classifier pipeline (social, crowd, and gov legs).
 *
 * ── PII floor (design D6) ─────────────────────────────────────────────
 * This table MUST NEVER store contact information: no phone numbers,
 * email addresses, real names, handle-to-identity mappings, IPs, or
 * user agents. The `description` JSONB column must only ever contain
 * public-facing caption / image-description text, and `author` is the
 * public handle only. No PII may be stored anywhere in this schema.
 * The Phase 4 aggregator joins on signal_kind + wait signals, never
 * on identity.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Table name is deliberately `feed_observations` — NOT
 * `wait_time_readings`, which is reserved by
 * GOVT_WAIT_TIME_SOURCES_PLAN §5 for Phase 3 government-page
 * extractions. The Phase 4 aggregator joins/unifies both source
 * classes downstream.
 */
// The unique index on (source_ref, observed_at) — the idempotency key — is
// declared here so `synchronize` (test DB) creates it, and created identically
// by migration 1862600000000-AddFeedObservations in dev/prod. The plain index
// on observed_at serves GET /feed-observations/summary's window predicate
// (migration 1863500000000; plain CREATE INDEX — small table, and the repo's
// global "all" migrations-transaction mode forbids a CONCURRENTLY override).
@Entity({ name: "feed_observations" })
@Index(
  "IDX_feed_observations_source_ref_observed_at",
  ["sourceRef", "observedAt"],
  { unique: true },
)
@Index("IDX_feed_observations_observed_at", ["observedAt"])
export class FeedObservation extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // 'social' | 'crowd' | 'govt'
  @Column({ name: "domain", type: "text" })
  domain: string;

  // e.g. "apify:clockworks/tiktok-scraper#12", "pizzabase:reports/42"
  @Column({ name: "source_ref", type: "text" })
  sourceRef: string;

  @Column({ name: "url", type: "text", nullable: true })
  url: string | null;

  // Public handle only — never a resolved real-world identity.
  @Column({ name: "author", type: "text", nullable: true })
  author: string | null;

  @Column({ name: "platform", type: "text", nullable: true })
  platform: string | null;

  @Column({ name: "observed_at", type: "timestamp with time zone" })
  observedAt: Date;

  @Column({
    name: "posted_at",
    type: "timestamp with time zone",
    nullable: true,
  })
  postedAt: Date | null;

  // raw/state/county/precinct — the crowd leg populates it; social legs
  // match against locations later.
  @Column({ name: "location", type: "jsonb", nullable: true })
  location: Record<string, unknown> | null;

  // e.g. "poll_line_report", "user_report"
  @Column({ name: "signal_kind", type: "text" })
  signalKind: string;

  @Column({ name: "wait_minutes", type: "int", nullable: true })
  waitMinutes: number | null;

  @Column({ name: "wait_category", type: "text", nullable: true })
  waitCategory: string | null;

  @Column({ name: "confidence", type: "float" })
  confidence: number;

  @Column({ name: "provider", type: "text", nullable: true })
  provider: string | null;

  @Column({ name: "relevant", type: "boolean", nullable: true })
  relevant: boolean | null;

  // feedflag DescriptionSet — caption + image descriptions only (PII floor).
  @Column({ name: "description", type: "jsonb" })
  description: Record<string, unknown>;

  asJSON(): Record<string, unknown> {
    return {
      id: this.id,
      createdAt: this.createdAt,
      domain: this.domain,
      sourceRef: this.sourceRef,
      url: this.url,
      author: this.author,
      platform: this.platform,
      observedAt: this.observedAt,
      postedAt: this.postedAt,
      location: this.location,
      signalKind: this.signalKind,
      waitMinutes: this.waitMinutes,
      waitCategory: this.waitCategory,
      confidence: this.confidence,
      provider: this.provider,
      relevant: this.relevant,
      description: this.description,
    };
  }
}
