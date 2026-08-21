import {
  TEMPLATES,
  renderMessage,
  truncateMessage,
  renderAndTruncate,
  MessageOrder,
  MAX_BLUESKY_LENGTH,
  MAX_TWEET_LENGTH,
} from "./message-templates";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleOrder: MessageOrder = {
  quantity: 10,
  orderType: "pizzas",
  restaurant: "Pizza Hut",
  location: {
    city: "Portland",
    state: "OR",
    address: "123 Main St",
  },
};

const donutOrder: MessageOrder = {
  quantity: 5,
  orderType: "dozen donuts",
  restaurant: null,
  location: {
    city: "Chicago",
    state: "IL",
    address: "456 Oak Ave",
  },
};

const noRestaurantOrder: MessageOrder = {
  quantity: 32,
  orderType: "pizzas",
  restaurant: null,
  location: {
    city: "Austin",
    state: "TX",
    address: "789 Elm St",
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TEMPLATES", () => {
  it("has exactly 35 templates", () => {
    expect(TEMPLATES).toHaveLength(35);
  });

  it("each template is a non-empty string", () => {
    for (const t of TEMPLATES) {
      expect(typeof t).toBe("string");
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it("all templates reference only known placeholders", () => {
    const knownPlaceholders = [
      "{{3. Pizzas}}",
      "{{2. Restaurant}}",
      "{{3. Restaurant}}",
      "{{2. Location City}}",
      "{{2. Location State}}",
      "{{2. Location State Name}}",
      "{{2. Location Address}}",
    ];

    for (const t of TEMPLATES) {
      // Find all {{...}} patterns
      const matches = t.match(/\{\{.*?\}\}/g) || [];
      for (const m of matches) {
        expect(knownPlaceholders).toContain(m);
      }
    }
  });
});

describe("renderMessage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // Placeholder rendering
  // ------------------------------------------------------------------
  it("renders {{3. Pizzas}} correctly for pizza orders", () => {
    jest.spyOn(Math, "random").mockReturnValue(0); // pick first template
    const text = renderMessage(sampleOrder);
    expect(text).toContain("10 pizzas");
    expect(text).not.toContain("{{3. Pizzas}}");
  });

  it("renders {{3. Pizzas}} correctly for donut orders", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const text = renderMessage(donutOrder);
    expect(text).toContain("5 dozen donuts");
    expect(text).not.toContain("{{3. Pizzas}}");
  });

  it("renders {{3. Pizzas}} correctly for unknown order types", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const order: MessageOrder = {
      ...sampleOrder,
      orderType: "cookies",
      quantity: 7,
    };
    const text = renderMessage(order);
    expect(text).toContain("7 cookies");
  });

  it("renders {{2. Restaurant}} and {{3. Restaurant}} correctly", () => {
    // Template index 1 uses {{3. Restaurant}}
    jest.spyOn(Math, "random").mockReturnValue(1 / TEMPLATES.length);
    const text = renderMessage(sampleOrder);
    expect(text).toContain("Pizza Hut");
  });

  it("renders {{2. Location City}} correctly", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const text = renderMessage(sampleOrder);
    expect(text).toContain("Portland");
  });

  it("renders {{2. Location State}} as abbreviation", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const text = renderMessage(sampleOrder);
    expect(text).toContain("OR");
  });

  it("renders {{2. Location State Name}} as full state name", () => {
    // Template 1 uses {{2. Location State Name}}
    jest.spyOn(Math, "random").mockReturnValue(1 / TEMPLATES.length);
    const text = renderMessage(sampleOrder);
    expect(text).toContain("Oregon");
  });

  it("renders {{2. Location Address}} correctly", () => {
    // Template 2 uses {{2. Location Address}}
    jest.spyOn(Math, "random").mockReturnValue(2 / TEMPLATES.length);
    const text = renderMessage(sampleOrder);
    expect(text).toContain("123 Main St");
  });

  // ------------------------------------------------------------------
  // State name fallback
  // ------------------------------------------------------------------
  it("uses abbreviation when state is unknown", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const order: MessageOrder = {
      ...sampleOrder,
      location: { ...sampleOrder.location, state: "XX" },
    };
    const text = renderMessage(order);
    expect(text).toContain("XX");
    expect(text).not.toContain("Oregon");
  });

  it("renders full state names for all valid US states", () => {
    // Template 1 uses {{2. Location State Name}}
    jest.spyOn(Math, "random").mockReturnValue(1 / TEMPLATES.length);
    const stateMap: Record<string, string> = {
      CA: "California",
      NY: "New York",
      TX: "Texas",
      FL: "Florida",
      DC: "District of Columbia",
    };
    for (const [abbr, full] of Object.entries(stateMap)) {
      const order: MessageOrder = {
        ...sampleOrder,
        location: { ...sampleOrder.location, state: abbr, city: "TestCity" },
      };
      const text = renderMessage(order);
      expect(text).toContain(full);
    }
  });

  // ------------------------------------------------------------------
  // Restaurant handling
  // ------------------------------------------------------------------
  it("renders restaurant when set", () => {
    // Template 2 uses {{2. Restaurant}}
    jest.spyOn(Math, "random").mockReturnValue(2 / TEMPLATES.length);
    const text = renderMessage(sampleOrder);
    expect(text).toContain("Pizza Hut");
  });

  it("handles null restaurant without leftover {{", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const text = renderMessage(noRestaurantOrder);
    expect(text).not.toContain("{{");
    expect(text).not.toContain("}}");
  });

  // ------------------------------------------------------------------
  // No leftover placeholders
  // ------------------------------------------------------------------
  it("has no leftover {{}} in any template", () => {
    // Test every template with and without restaurant
    jest.spyOn(Math, "random").mockReturnValue(0);
    for (let i = 0; i < TEMPLATES.length; i++) {
      // Mock to pick each template in sequence
      jest.spyOn(Math, "random").mockReturnValue((i + 0.1) / TEMPLATES.length);

      const withRestaurant = renderMessage(sampleOrder);
      expect(withRestaurant).not.toContain("{{");
      expect(withRestaurant).not.toContain("}}");
      expect(withRestaurant.length).toBeGreaterThan(0);

      const withoutRestaurant = renderMessage(noRestaurantOrder);
      expect(withoutRestaurant).not.toContain("{{");
      expect(withoutRestaurant).not.toContain("}}");
      expect(withoutRestaurant.length).toBeGreaterThan(0);
    }
  });

  // ------------------------------------------------------------------
  // Random selection
  // ------------------------------------------------------------------
  it("selects different templates on successive calls", () => {
    // When Math.random returns 0 → index 0
    jest.spyOn(Math, "random").mockReturnValue(0);
    const text1 = renderMessage(sampleOrder);

    // When Math.random returns just over 1/TEMPLATES.length → index 1
    jest.spyOn(Math, "random").mockReturnValue(1.5 / TEMPLATES.length);
    const text2 = renderMessage(sampleOrder);

    // Different templates should produce different text
    expect(text1).not.toBe(text2);
  });

  it("selects first template when random = 0", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const text = renderMessage(sampleOrder);
    // First template contains "polling place"
    expect(text).toContain("polling place");
  });

  it("selects last template when random is near 1", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.9999);
    const text = renderMessage(sampleOrder);
    // Last template contains "Slice to meet you"
    expect(text).toContain("Slice to meet you");
  });
});

// ---------------------------------------------------------------------------
// truncateMessage
// ---------------------------------------------------------------------------
describe("truncateMessage", () => {
  it("returns original text when under max length", () => {
    const text = "Short message";
    expect(truncateMessage(text, 100)).toBe("Short message");
  });

  it("returns original text when exactly at max length", () => {
    const text = "1234567890";
    expect(truncateMessage(text, 10)).toBe("1234567890");
  });

  it("truncates and appends ... when over max length", () => {
    const text = "This is a long message that should be cut";
    const result = truncateMessage(text, 20);
    expect(result.length).toBe(20);
    expect(result).toBe("This is a long me...");
  });

  it("handles maxLength of 3 (just the ellipsis)", () => {
    const text = "anything";
    const result = truncateMessage(text, 3);
    expect(result).toBe("...");
    expect(result.length).toBe(3);
  });

  it("handles maxLength less than 3 gracefully", () => {
    const text = "anything";
    const result = truncateMessage(text, 2);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// renderAndTruncate
// ---------------------------------------------------------------------------
describe("renderAndTruncate", () => {
  beforeEach(() => {
    jest.spyOn(Math, "random").mockReturnValue(0); // predictable template
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses 280 char limit for twitter", () => {
    const text = renderAndTruncate(sampleOrder, "twitter");
    expect(text.length).toBeLessThanOrEqual(MAX_TWEET_LENGTH);
    expect(text).not.toContain("{{");
  });

  it("uses 300 char limit for bluesky", () => {
    const text = renderAndTruncate(sampleOrder, "bluesky");
    expect(text.length).toBeLessThanOrEqual(MAX_BLUESKY_LENGTH);
    expect(text).not.toContain("{{");
  });

  it("does not truncate messages under the limit", () => {
    const text = renderAndTruncate(sampleOrder, "bluesky");
    // The first template renders well under 300 chars
    expect(text.length).toBeLessThan(MAX_BLUESKY_LENGTH);
    expect(text).not.toContain("...");
  });
});
