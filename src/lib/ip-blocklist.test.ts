import * as crypto from "crypto";
import { ipHash, normalizeIp, sha256Hex } from "./ip-blocklist";

// TEST-NET documentation addresses (RFC 5737) — never real client IPs.
const V4 = "192.0.2.128";

describe("#normalizeIp", () => {
  it("passes a plain IPv4 address through unchanged", () => {
    expect(normalizeIp(V4)).toBe(V4);
  });

  it("folds IPv4-mapped IPv6 (dotted-quad form) to the IPv4 address", () => {
    expect(normalizeIp("::ffff:192.0.2.128")).toBe(V4);
  });

  it("folds IPv4-mapped IPv6 case-insensitively", () => {
    expect(normalizeIp("::FFFF:192.0.2.128")).toBe(V4);
  });

  it("folds IPv4-mapped IPv6 (hex-encoded form) to the IPv4 address", () => {
    // c000:280 = 192.0.2.128
    expect(normalizeIp("::ffff:c000:280")).toBe(V4);
  });

  it("numerically normalizes IPv4 leading zeros so padding does not change the hash", () => {
    expect(normalizeIp("192.168.001.001")).toBe("192.168.1.1");
  });

  it("expands a compressed IPv6 address deterministically", () => {
    expect(normalizeIp("2001:db8::1")).toBe(
      "2001:0db8:0000:0000:0000:0000:0000:0001",
    );
  });

  it("maps the verbose form of the same IPv6 address to the same normalized form", () => {
    expect(normalizeIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(
      normalizeIp("2001:db8::1"),
    );
  });

  it("lowercases and pads hex groups case-insensitively", () => {
    expect(normalizeIp("2001:DB8::1")).toBe(normalizeIp("2001:db8::1"));
  });

  it("expands the loopback address to its full form", () => {
    expect(normalizeIp("::1")).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
  });

  it("expands an embedded IPv4 dotted-quad in a pure IPv6 address", () => {
    expect(normalizeIp("2001:db8::192.0.2.128")).toBe(
      "2001:0db8:0000:0000:0000:0000:c000:0280",
    );
    // Same address written purely in hex groups must hash identically.
    expect(normalizeIp("2001:db8::c000:280")).toBe(
      normalizeIp("2001:db8::192.0.2.128"),
    );
  });

  it("leaves the deprecated ::ffff:0:x.x.x.x form as IPv6 (not folded)", () => {
    // The embedded IPv4 occupies the last 32 bits (RFC 4291): 1.2.3.4 →
    // 0102:0304 — the same embedding rule the pure-v6 test above asserts
    // for "2001:db8::192.0.2.128" → "...c000:0280".
    expect(normalizeIp("::ffff:0:1.2.3.4")).toBe(
      "0000:0000:0000:0000:ffff:0000:0102:0304",
    );
    // ...and it must not fold to the bare IPv4 address.
    expect(normalizeIp("::ffff:0:1.2.3.4")).not.toBe("1.2.3.4");
  });

  it("folds an IPv4-mapped form whose embedded quad has leading zeros", () => {
    expect(normalizeIp("::ffff:192.168.001.001")).toBe("192.168.1.1");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeIp(`  ${V4}  `)).toBe(V4);
  });

  it("fails open on empty input", () => {
    expect(normalizeIp("")).toBe("");
    expect(normalizeIp(undefined as unknown as string)).toBe("");
  });

  it("fails open on garbage that is not an IP", () => {
    expect(normalizeIp("not-an-ip")).toBe("");
    expect(normalizeIp("fe80::1%en0")).toBe("");
  });

  it("fails open on invalid IPv4 octets", () => {
    expect(normalizeIp("999.0.0.1")).toBe("");
    expect(normalizeIp("256.0.0.1")).toBe("");
    expect(normalizeIp("1.2.3")).toBe("");
    expect(normalizeIp("1.2.3.4.5")).toBe("");
    expect(normalizeIp("a.b.c.d")).toBe("");
  });
});

describe("#sha256Hex", () => {
  it("matches Node's crypto digest of the same input", () => {
    expect(sha256Hex(V4)).toBe(
      crypto.createHash("sha256").update(V4).digest("hex"),
    );
  });

  it("produces 64 lowercase hex characters", () => {
    expect(sha256Hex(V4)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("#ipHash", () => {
  it("hashes IPv4 and its mapped-IPv6 form identically (issue #352 AC)", () => {
    expect(ipHash("::ffff:192.0.2.128")).toBe(ipHash(V4));
    expect(ipHash("::FFFF:192.0.2.128")).toBe(ipHash(V4));
    expect(ipHash("::ffff:c000:280")).toBe(ipHash(V4));
  });

  it("equals the direct SHA-256 of the normalized address", () => {
    expect(ipHash(V4)).toBe(sha256Hex(V4));
    expect(ipHash("2001:db8::1")).toBe(
      sha256Hex("2001:0db8:0000:0000:0000:0000:0000:0001"),
    );
  });

  it("always returns 64 lowercase hex characters for valid IPs", () => {
    expect(ipHash("1.2.3.4")).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash("2001:db8::1")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the empty-string fail-open sentinel for garbage", () => {
    expect(ipHash("garbage")).toBe("");
    expect(ipHash("")).toBe("");
  });

  it("differs between distinct IPs", () => {
    expect(ipHash("192.0.2.128")).not.toBe(ipHash("192.0.2.129"));
  });
});
