import { BannedPhoneNumber } from "./BannedPhoneNumber";

// A US number exercised in both its stored (web-form) and Twilio E.164
// forms. The E.164 form of the bare 10 digits is "+1" + the digits.
const BARE_US = "5038938626";
const E164_US = "+15038938626";

const makeBan = async (phoneNumber: string, reason = "Test ban") => {
  const ban = new BannedPhoneNumber();
  ban.phoneNumber = phoneNumber;
  ban.reason = reason;
  ban.bannedBy = "tester";
  await ban.save();
  return ban;
};

describe("BannedPhoneNumber entity", () => {
  describe("#isBanned", () => {
    it("catches a ban stored as bare 10 digits when queried with the +1 E.164 form", async () => {
      await makeBan(BARE_US);

      expect(await BannedPhoneNumber.isBanned(E164_US)).toBe(true);
    });

    it("catches a ban stored as +1 E.164 when queried with bare 10 digits", async () => {
      await makeBan(E164_US);

      expect(await BannedPhoneNumber.isBanned(BARE_US)).toBe(true);
    });

    it("converges all common US formatting variants on the same ban", async () => {
      await makeBan(BARE_US);

      for (const q of [
        E164_US,
        "503-893-8626",
        "(503) 893-8626",
        BARE_US,
        "15038938626",
      ]) {
        expect(await BannedPhoneNumber.isBanned(q)).toBe(true);
      }
    });

    it("returns false for a number that is not banned", async () => {
      await makeBan(BARE_US);

      expect(await BannedPhoneNumber.isBanned("+15551234567")).toBe(false);
      expect(await BannedPhoneNumber.isBanned("(503) 893-0000")).toBe(false);
    });

    it("returns false when no bans exist at all", async () => {
      expect(await BannedPhoneNumber.isBanned(E164_US)).toBe(false);
    });

    it("non-US number exact-matches itself and does not invent variants", async () => {
      const ukPhone = "+442071234567";
      await makeBan(ukPhone, "UK spam");

      expect(await BannedPhoneNumber.isBanned(ukPhone)).toBe(true);

      // The bare digits-with-country-code form must NOT match — no
      // variants are invented for non-US numbers.
      expect(await BannedPhoneNumber.isBanned("442071234567")).toBe(false);
    });
  });
});
