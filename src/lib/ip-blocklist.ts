/**
 * IP blocklist helpers (issue #352).
 *
 * The blocklist stores only SHA-256 hashes of normalized IP addresses —
 * never raw IPs — so it is not a PII ledger. Incoming IPs are normalized
 * and hashed the same way, so blocking logic and admin entries always agree.
 *
 * Normalization rules:
 *  - Trim and lowercase.
 *  - IPv4: numeric-normalized dotted quad (leading zeros dropped, e.g.
 *    "192.168.001.001" → "192.168.1.1"). Out-of-range octets → "".
 *  - IPv4-mapped IPv6 (RFC 4291 canonical form) is folded to IPv4:
 *    "::ffff:192.0.2.128" and "::ffff:c000:280" both → "192.0.2.128".
 *  - Pure IPv6: fully expanded to 8 lowercase 4-hex-digit groups so
 *    "2001:db8::1" and "2001:0db8:0000:0000:0000:0000:0000:0001" hash the
 *    same. The deprecated "::ffff:0:x.x.x.x" form is left as a v6 address.
 *  - Unparseable input (garbage, zone IDs, empty) → "" (fail-open sentinel:
 *    the blocklist check is skipped for that submission).
 */

import * as crypto from "crypto";
import * as net from "net";

export const sha256Hex = (input: string): string =>
  crypto.createHash("sha256").update(input).digest("hex");

const DOTTED_QUAD = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const MAPPED_V4_DOTTED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const MAPPED_V4_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

const normalizeIPv4 = (ip: string): string => {
  const octets = ip.split(".");
  if (octets.length !== 4) return "";
  const nums: number[] = [];
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return "";
    nums.push(parseInt(octet, 10));
  }
  if (nums.some((n) => n < 0 || n > 255)) return "";
  return nums.join(".");
};

const normalizeIPv6 = (ip: string): string => {
  // IPv4-mapped IPv6 → the IPv4 address itself.
  const dotted = ip.match(MAPPED_V4_DOTTED);
  if (dotted) {
    const v4 = normalizeIPv4(dotted[1]);
    if (v4) return v4;
  }
  const hex = ip.match(MAPPED_V4_HEX);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join(".");
  }
  return expandIPv6(ip);
};

/**
 * Expand an IPv6 address to 8 lowercase 4-hex-digit colon-separated groups.
 * At most one "::" is permitted; `net.isIP` has already validated syntax,
 * so every "" return here is a defensive fail-open.
 */
const expandIPv6 = (ip: string): string => {
  const sections = ip.split("::");
  if (sections.length > 2) return "";

  const parseGroups = (part: string): string[] | null => {
    if (!part) return [];
    const groups: string[] = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        // Embedded IPv4 dotted-quad (e.g. "2001:db8::192.0.2.128").
        const v4 = normalizeIPv4(piece);
        if (!v4) return null;
        const [a, b, c, d] = v4.split(".").map(Number);
        groups.push(
          ((a << 8) | b).toString(16).padStart(4, "0"),
          ((c << 8) | d).toString(16).padStart(4, "0"),
        );
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        groups.push(piece);
      } else {
        return null;
      }
    }
    return groups;
  };

  const head = parseGroups(sections[0]);
  const tail = sections.length === 2 ? parseGroups(sections[1]) : [];
  if (head === null || tail === null) return "";

  const fill = sections.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return "";
  const groups =
    sections.length === 2 ? [...head, ...Array(fill).fill("0"), ...tail] : head;
  if (groups.length !== 8) return "";

  return groups.map((g) => g.toLowerCase().padStart(4, "0")).join(":");
};

export const normalizeIp = (raw: string): string => {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  // net.isIP rejects IPv4 octets with leading zeros (Node >= 18 hardening),
  // so detect dotted-quad shapes ourselves and let normalizeIPv4 do the
  // numeric normalization ("192.168.001.001" → "192.168.1.1").
  if (DOTTED_QUAD.test(trimmed)) return normalizeIPv4(trimmed);
  // Same for an IPv4-mapped form whose embedded quad has leading zeros.
  const mapped = trimmed.match(MAPPED_V4_DOTTED);
  if (mapped) {
    const v4 = normalizeIPv4(mapped[1]);
    if (v4) return v4;
  }
  const version = net.isIP(trimmed);
  if (version === 4) return normalizeIPv4(trimmed);
  if (version === 6) return normalizeIPv6(trimmed);
  return "";
};

/**
 * Hash an incoming IP the way the blocklist stores it. Returns "" when the
 * address cannot be normalized — callers treat that as "not blocked".
 */
export const ipHash = (raw: string): string => {
  const normalized = normalizeIp(raw);
  if (!normalized) return "";
  return sha256Hex(normalized);
};
