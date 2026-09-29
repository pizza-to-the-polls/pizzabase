import { deriveHashtags } from "./clip-hashtags";

describe("deriveHashtags", () => {
  it("produces the deterministic starter set for a city/state", () => {
    expect(deriveHashtags("Philadelphia", "PA")).toEqual([
      "#votingrights",
      "#ElectionDay",
      "#PA",
      "#Philadelphia",
    ]);
  });

  it("is deterministic — same input, same output", () => {
    const a = deriveHashtags("Portland", "OR");
    const b = deriveHashtags("Portland", "OR");
    expect(a).toEqual(b);
  });

  it("strips non-alphanumeric characters from city names", () => {
    expect(deriveHashtags("St. Louis", "MO")).toContain("#StLouis");
    expect(deriveHashtags("Kansas City", "MO")).toContain("#KansasCity");
  });

  it("handles hyphenated city names", () => {
    expect(deriveHashtags("Winston-Salem", "NC")).toContain("#WinstonSalem");
  });

  it("always includes the base voting-rights tags", () => {
    const tags = deriveHashtags("Anywhere", "ZZ");
    expect(tags).toContain("#votingrights");
    expect(tags).toContain("#ElectionDay");
  });
});
