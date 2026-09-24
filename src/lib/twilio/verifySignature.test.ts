import crypto from "crypto";
import {
  verifyTwilioSignature,
  isTwilioSignatureConfigured,
} from "./verifySignature";

const TWILIO_AUTH_TOKEN_ENV = "TWILIO_AUTH_TOKEN";

// Both vectors come from Twilio's official Python SDK test suite
// (twilio-python tests/unit/test_request_validator.py) and exercise the
// documented validation algorithm with auth token "12345".
// https://www.twilio.com/docs/usage/security#validating-requests
const SDK_URL = "https://mycompany.com/myapp.php?foo=1&bar=2";

// Vector 1 — simple (single-value) params.
const VECTOR_1_BODY = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+14158675309",
  Digits: "1234",
  From: "+14158675309",
  To: "+18005551212",
};
const VECTOR_1_SIGNATURE = "RSOYDt4T1cUTdK1PDd93/VVr8B8=";

// Vector 2 — multi-value params: Digits arrives as ["5678", "1234", "1234"].
// Values are sorted and de-duplicated before concatenation, so the base
// string contains `Digits1234Digits5678` (not the arrival order).
const VECTOR_2_BODY = {
  Sid: "CA123",
  SidAccount: "AC123",
  Digits: ["5678", "1234", "1234"],
};
const VECTOR_2_SIGNATURE = "IK+Dwps556ElfBT0I3Rgjkr1wJU=";

describe("verifyTwilioSignature", () => {
  afterEach(() => {
    delete process.env[TWILIO_AUTH_TOKEN_ENV];
  });

  describe("official SDK test vectors", () => {
    it("accepts the simple single-value params vector (token 12345)", () => {
      expect(
        verifyTwilioSignature({
          url: SDK_URL,
          body: VECTOR_1_BODY,
          signature: VECTOR_1_SIGNATURE,
          authToken: "12345",
        }),
      ).toBe(true);
    });

    it("accepts the multi-value params vector (token 12345)", () => {
      expect(
        verifyTwilioSignature({
          url: SDK_URL,
          body: VECTOR_2_BODY,
          signature: VECTOR_2_SIGNATURE,
          authToken: "12345",
        }),
      ).toBe(true);
    });

    it("accepts duplicate values in any arrival order (values sorted + deduped)", () => {
      // Sorting and de-duplication make the base string insensitive to the
      // order in which duplicate form fields arrive.
      expect(
        verifyTwilioSignature({
          url: SDK_URL,
          body: { ...VECTOR_2_BODY, Digits: ["1234", "1234", "5678"] },
          signature: VECTOR_2_SIGNATURE,
          authToken: "12345",
        }),
      ).toBe(true);
    });

    it("rejects a tampered body against a valid signature", () => {
      expect(
        verifyTwilioSignature({
          url: SDK_URL,
          body: { ...VECTOR_1_BODY, Digits: "9999" },
          signature: VECTOR_1_SIGNATURE,
          authToken: "12345",
        }),
      ).toBe(false);
    });

    it("accepts a body equivalent to the signed duplicate values", () => {
      // Canonicalization sorts multi-value keys and removes duplicates, so
      // ["5678", "1234"] and ["5678", "1234", "1234"] produce the same
      // base string (Digits1234Digits5678) and verify as equivalent. This is
      // the behavior pinned by Twilio's official SDK vector above.
      expect(
        verifyTwilioSignature({
          url: SDK_URL,
          body: { ...VECTOR_2_BODY, Digits: ["5678", "1234"] },
          signature: VECTOR_2_SIGNATURE,
          authToken: "12345",
        }),
      ).toBe(true);
    });

    it("rejects a value added after canonicalization of duplicates", () => {
      // An extra distinct value changes the base string → signature fails.
      expect(
        verifyTwilioSignature({
          url: SDK_URL,
          body: { ...VECTOR_2_BODY, Digits: ["5678", "1234", "9999"] },
          signature: VECTOR_2_SIGNATURE,
          authToken: "12345",
        }),
      ).toBe(false);
    });

    it("rejects a tampered URL against a valid signature", () => {
      expect(
        verifyTwilioSignature({
          url: SDK_URL.replace("myapp", "myapp2"),
          body: VECTOR_1_BODY,
          signature: VECTOR_1_SIGNATURE,
          authToken: "12345",
        }),
      ).toBe(false);
    });
  });

  describe("computed vectors", () => {
    it("accepts a single-param signature computed with crypto", () => {
      const url = "https://example.com/webhook";
      const body = { From: "+15551234567", MediaUrl0: "https://x/y.jpg" };
      const base = Object.keys(body)
        .sort()
        .reduce((acc, key) => acc + key + body[key], url);
      const signature = crypto
        .createHmac("sha1", "test-token")
        .update(base)
        .digest("base64");

      expect(
        verifyTwilioSignature({
          url,
          body,
          signature,
          authToken: "test-token",
        }),
      ).toBe(true);
    });

    it("accepts a signature derived from the env token", () => {
      process.env[TWILIO_AUTH_TOKEN_ENV] = "env-token";
      const url = "https://example.com/webhook?MsgSid=SM1";
      const body = { From: "+15551234567" };
      const base =
        url +
        Object.keys(body)
          .map((k) => k + body[k])
          .join("");
      const signature = crypto
        .createHmac("sha1", "env-token")
        .update(base)
        .digest("base64");

      expect(verifyTwilioSignature({ url, body, signature })).toBe(true);
    });

    it("rejects a body signed with a different token", () => {
      const url = "https://example.com/webhook";
      const body = { From: "+15551234567" };
      const base =
        url +
        Object.keys(body)
          .map((k) => k + body[k])
          .join("");
      const signature = crypto
        .createHmac("sha1", "attacker-token")
        .update(base)
        .digest("base64");

      expect(
        verifyTwilioSignature({
          url,
          body,
          signature,
          authToken: "test-token",
        }),
      ).toBe(false);
    });
  });

  describe("failure cases", () => {
    const url = "https://example.com/webhook";
    const body = { From: "+15551234567" };

    it("returns false when the signature header is missing (null)", () => {
      expect(
        verifyTwilioSignature({ url, body, signature: null, authToken: "t" }),
      ).toBe(false);
    });

    it("returns false when the signature header is empty", () => {
      expect(
        verifyTwilioSignature({ url, body, signature: "", authToken: "t" }),
      ).toBe(false);
    });

    it("returns false when the auth token is unset", () => {
      expect(
        verifyTwilioSignature({ url, body, signature: VECTOR_1_SIGNATURE }),
      ).toBe(false);
    });

    it("returns false for a malformed (non-base64) signature", () => {
      expect(
        verifyTwilioSignature({
          url,
          body,
          signature: "!!!not-base64!!!",
          authToken: "t",
        }),
      ).toBe(false);
    });

    it("returns false for a valid-base64 but wrong-length signature", () => {
      expect(
        verifyTwilioSignature({ url, body, signature: "abc", authToken: "t" }),
      ).toBe(false);
    });
  });
});

describe("isTwilioSignatureConfigured", () => {
  afterEach(() => {
    delete process.env[TWILIO_AUTH_TOKEN_ENV];
  });

  it("returns true when TWILIO_AUTH_TOKEN is set", () => {
    process.env[TWILIO_AUTH_TOKEN_ENV] = "some-token";
    expect(isTwilioSignatureConfigured()).toBe(true);
  });

  it("returns false when TWILIO_AUTH_TOKEN is unset", () => {
    expect(isTwilioSignatureConfigured()).toBe(false);
  });

  it("returns false when TWILIO_AUTH_TOKEN is empty", () => {
    process.env[TWILIO_AUTH_TOKEN_ENV] = "";
    expect(isTwilioSignatureConfigured()).toBe(false);
  });
});
