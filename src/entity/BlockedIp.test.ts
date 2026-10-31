import { BlockedIp } from "./BlockedIp";
import { ipHash } from "../lib/ip-blocklist";

const blockIp = async (ip: string, reason = "Test block") => {
  const entry = new BlockedIp();
  entry.ipHash = ipHash(ip);
  entry.reason = reason;
  entry.blockedBy = "tester";
  await entry.save();
  return entry;
};

describe("BlockedIp entity", () => {
  describe("#isBlocked", () => {
    it("catches a block stored for the hash of the queried IPv4", async () => {
      await blockIp("192.0.2.128");

      expect(await BlockedIp.isBlocked("192.0.2.128")).toBe(true);
    });

    it("catches a query in its IPv4-mapped IPv6 form against a v4-stored row", async () => {
      await blockIp("203.0.113.9");

      expect(await BlockedIp.isBlocked("::ffff:203.0.113.9")).toBe(true);
    });

    it("returns false for an IP that is not blocked", async () => {
      await blockIp("203.0.113.9");

      expect(await BlockedIp.isBlocked("203.0.113.10")).toBe(false);
    });

    it("returns false when no blocks exist at all", async () => {
      expect(await BlockedIp.isBlocked("203.0.113.9")).toBe(false);
    });

    it("fails open for unparseable input even when blocks exist", async () => {
      await blockIp("203.0.113.9");

      expect(await BlockedIp.isBlocked("not-an-ip")).toBe(false);
      expect(await BlockedIp.isBlocked("")).toBe(false);
      expect(await BlockedIp.isBlocked(undefined as unknown as string)).toBe(
        false,
      );
    });
  });

  describe("#findByIdOrIpHash", () => {
    it("finds an entry by numeric id", async () => {
      const entry = await blockIp("203.0.113.9");

      const found = await BlockedIp.findByIdOrIpHash(`${entry.id}`);
      expect(found.id).toBe(entry.id);
    });

    it("finds an entry by its stored hash", async () => {
      const entry = await blockIp("203.0.113.9");

      const found = await BlockedIp.findByIdOrIpHash(ipHash("203.0.113.9"));
      expect(found.id).toBe(entry.id);
    });

    it("returns null for an unknown id/hash", async () => {
      expect(await BlockedIp.findByIdOrIpHash("9999999")).toBeNull();
    });
  });

  describe("#asJSON", () => {
    it("exposes the hash, never a raw IP", async () => {
      const entry = await blockIp("203.0.113.9");

      const json = entry.asJSON();
      expect(json.ipHash).toBe(ipHash("203.0.113.9"));
      expect(JSON.stringify(json)).not.toContain("203.0.113.9");
    });
  });
});
