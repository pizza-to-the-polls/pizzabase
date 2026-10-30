import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from "typeorm";
import { ipHash } from "../lib/ip-blocklist";

/**
 * Persisted IP blocklist (issue #352). Only SHA-256 hashes of normalized
 * IPs are stored — never raw addresses — so the table is not a PII ledger.
 * Checked at the top of the report/upload submission controllers; entries
 * are curated by admins via the /blocked-ips API (see docs/ip-blocklist.md).
 */
@Entity({ name: "blocked_ips" })
export class BlockedIp extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "ip_hash", length: 64 })
  @Index({ unique: true })
  ipHash: string;

  @Column({ type: "text", nullable: true })
  reason: string;

  @Column({ name: "blocked_by", nullable: true })
  blockedBy: string;

  @CreateDateColumn({ name: "blocked_at" })
  blockedAt: Date;

  // ipHash is not PII (one-way hash of a normalized address).
  asJSON() {
    const { id, ipHash, reason, blockedBy, blockedAt } = this;
    return { id, ipHash, reason, blockedBy, blockedAt };
  }

  static async isBlocked(rawIp: string): Promise<boolean> {
    const hash = ipHash(rawIp);
    // Fail-open: unparseable addresses (garbage, zone IDs, dev artifacts)
    // are never blocked.
    if (!hash) return false;
    return (await this.count({ where: { ipHash: hash } })) > 0;
  }

  static async findByIdOrIpHash(idOrIpHash: string): Promise<BlockedIp | null> {
    // SERIAL ids are small; hashes are 64 hex chars. Only treat short
    // all-digit values as ids so a hash never overflows integer.
    if (/^\d{1,7}$/.test(idOrIpHash)) {
      const byId = await this.findOne({
        where: { id: Number(idOrIpHash) },
      });
      if (byId) return byId;
    }

    return this.findOne({ where: { ipHash: idOrIpHash } });
  }
}
