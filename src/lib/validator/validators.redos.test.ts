import { isValidEmail, isValidPhone } from "./normalizeContact";
import { normalizeURL } from "./normalizeURL";

describe("isValidEmail", () => {
  test("accepts ordinary addresses", () => {
    expect(isValidEmail("trusted@example.com")).toBe(true);
    expect(isValidEmail("first.last@sub.example.co")).toBe(true);
  });

  test("rejects garbage", () => {
    expect(isValidEmail("not-valid")).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("isValidPhone", () => {
  test("accepts common formats", () => {
    expect(isValidPhone("555-234-2345")).toBe(true);
    expect(isValidPhone("(555) 234 2345")).toBe(true);
  });

  test("rejects garbage", () => {
    expect(isValidPhone("not-valid")).toBe(false);
    expect(isValidPhone(undefined)).toBe(false);
  });
});

describe("normalizeURL ReDoS safety", () => {
  const evilInputs = [
    "http://" + "0.".repeat(5000) + "0", // host label repetition
    "a".repeat(50000), // long unstructured string
    "http://" + "a-".repeat(5000) + ".com", // hyphen/label ambiguity
    "@" + "0.0.0.0.0.0.".repeat(2000),
  ];

  test.each(evilInputs)("resolves quickly for %j", (input) => {
    const start = Date.now();
    normalizeURL(input);
    // Catastrophic backtracking would blow far past this budget.
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("still validates normal URLs", () => {
    expect(
      normalizeURL("http://twitter.com/someone/status/123?utm_diff"),
    ).toEqual("http://twitter.com/someone/status/123");
    expect(normalizeURL("not-valid")).toBeNull();
  });
});
