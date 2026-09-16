import {
  TEMPLATES,
  renderTemplate,
  renderMessage,
  preserveWhitespace,
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

/**
 * Order shapes used to render *every* template (issue #223 acceptance
 * criteria): short, medium, and long values — plus edge cases — so that
 * variable-length content can never break a template's layout or length.
 */
const AUDIT_SHAPES: MessageOrder[] = [
  // short
  {
    quantity: 2,
    orderType: "pizzas",
    restaurant: "Domino's",
    location: { city: "Dover", state: "DE", address: "1 Main St" },
  },
  // medium
  sampleOrder,
  // long: long restaurant, long city/address, longest state name
  {
    quantity: 24,
    orderType: "pizzas",
    restaurant: "Antonio's Pizza & Pasta Kitchen",
    location: {
      city: "Rancho Santa Margarita",
      state: "DC",
      address: "1600 Pennsylvania Avenue Northwest",
    },
  },
  // no restaurant, singular quantity
  {
    quantity: 1,
    orderType: "pizzas",
    restaurant: null,
    location: { city: "Eek", state: "AK", address: "42 North Ln" },
  },
  // donuts with a restaurant
  {
    quantity: 5,
    orderType: "dozen donuts",
    restaurant: "Krispy Kreme",
    location: { city: "Chicago", state: "IL", address: "456 Oak Ave" },
  },
  // huge quantity, very long names
  {
    quantity: 100,
    orderType: "pizzas",
    restaurant: "Giordano's Famous Chicago Deep Dish",
    location: {
      city: "Thompson Springs",
      state: "UT",
      address: "789 West Martin Luther King Boulevard",
    },
  },
];

// ---------------------------------------------------------------------------
// TEMPLATES
// ---------------------------------------------------------------------------

describe("TEMPLATES", () => {
  it("has exactly 263 templates", () => {
    expect(TEMPLATES).toHaveLength(263);
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
      const matches = t.match(/\{\{.*?\}\}/g) || [];
      for (const m of matches) {
        expect(knownPlaceholders).toContain(m);
      }
    }
  });

  // -----------------------------------------------------------------
  // Art-safety rules (issue #223): Twitter/X, Threads, and BlueSky
  // render posts in proportional fonts, so templates must never
  // depend on cross-line character alignment or whitespace runs
  // that the platforms collapse.
  // -----------------------------------------------------------------
  describe("art safety", () => {
    const BOX_SIDES = /[│┃┠┨┞┧├┤]/;

    const hasBorderRun = (line: string): boolean => {
      for (const ch of "─━═┅┉") {
        let run = 0;
        for (const c of line) {
          run = c === ch ? run + 1 : 0;
          if (run >= 3) return true;
        }
      }
      return false;
    };

    const pipeCount = (line: string): number =>
      (line.match(/\|/g) || []).length;

    it("never places variable content between box borders on one line", () => {
      for (const t of TEMPLATES) {
        for (const line of t.split("\n")) {
          // | {{3. Pizzas}} | — variable-length content tears fixed borders
          expect({
            template: t,
            offending: line,
            boxed: /\|[^|\n]*\{\{[^}]*\}\}[^|\n]*\|/.test(line),
          }).toEqual(expect.objectContaining({ boxed: false }));
        }
      }
    });

    it("never puts variable content on lines with alignment art", () => {
      for (const t of TEMPLATES) {
        for (const line of t.split("\n")) {
          if (!/\{\{.*?\}\}/.test(line)) continue;
          // 2+ pipes or a long border run mean art a variable-length value
          // would tear apart
          expect(pipeCount(line)).toBeLessThan(2);
          expect(hasBorderRun(line)).toBe(false);
          expect(BOX_SIDES.test(line)).toBe(false);
        }
      }
    });

    it("renders every template with every audit shape", () => {
      // issue #223 acceptance criteria: every template rendered with
      // short/medium/long inputs
      for (const t of TEMPLATES) {
        for (const order of AUDIT_SHAPES) {
          const text = renderTemplate(t, order);
          expect(text).not.toContain("{{");
          expect(text).not.toContain("}}");
          expect(text.length).toBeGreaterThan(0);
        }
      }
    });

    it("never exceeds the Twitter limit with any audit shape", () => {
      // mid-post truncation ("...") looks broken, especially in art
      for (const t of TEMPLATES) {
        for (const order of AUDIT_SHAPES) {
          const text = renderTemplate(t, order);
          expect(text.length).toBeLessThanOrEqual(MAX_TWEET_LENGTH);
        }
      }
    });

    it("renders no compressible whitespace (platforms collapse it)", () => {
      for (const t of TEMPLATES) {
        for (const order of AUDIT_SHAPES) {
          const text = renderTemplate(t, order);
          // runs of 2+ regular spaces or leading regular spaces get
          // collapsed by the platforms — they must be NBSPs by now
          expect(/ {2,}/.test(text)).toBe(false);
          expect(/^ /m.test(text)).toBe(false);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe("renderTemplate", () => {
  it("renders {{3. Pizzas}} correctly for pizza orders", () => {
    const text = renderTemplate(TEMPLATES[0], sampleOrder);
    expect(text).toContain("10 pizzas");
    expect(text).not.toContain("{{3. Pizzas}}");
  });

  it("renders {{3. Pizzas}} with singular label for one pizza", () => {
    const text = renderTemplate(TEMPLATES[0], { ...sampleOrder, quantity: 1 });
    expect(text).toContain("1 pizza");
  });

  it("renders {{3. Pizzas}} correctly for donut orders", () => {
    const text = renderTemplate(TEMPLATES[0], donutOrder);
    expect(text).toContain("5 dozen donuts");
    expect(text).not.toContain("{{3. Pizzas}}");
  });

  it("renders {{3. Pizzas}} correctly for unknown order types", () => {
    const order: MessageOrder = {
      ...sampleOrder,
      orderType: "cookies",
      quantity: 7,
    };
    const text = renderTemplate(TEMPLATES[0], order);
    expect(text).toContain("7 cookies");
  });

  it("renders restaurant placeholders correctly", () => {
    const withRestaurant = TEMPLATES.find(
      (t) => t.includes("{{3. Restaurant}}") && t.includes("{{3. Pizzas}}"),
    )!;
    const text = renderTemplate(withRestaurant, sampleOrder);
    expect(text).toContain("Pizza Hut");
    expect(text).toContain("10 pizzas");
  });

  it("renders {{2. Location City}} correctly", () => {
    const text = renderTemplate(TEMPLATES[0], sampleOrder);
    expect(text).toContain("Portland");
  });

  it("renders {{2. Location State}} as abbreviation", () => {
    const t = TEMPLATES.find((tpl) => tpl.includes("{{2. Location State}}"))!;
    const text = renderTemplate(t, sampleOrder);
    expect(text).toContain("OR");
  });

  it("renders {{2. Location State Name}} as full state name", () => {
    const t = TEMPLATES.find((tpl) =>
      tpl.includes("{{2. Location State Name}}"),
    )!;
    const text = renderTemplate(t, sampleOrder);
    expect(text).toContain("Oregon");
  });

  it("renders {{2. Location Address}} correctly", () => {
    const t = TEMPLATES.find((tpl) => tpl.includes("{{2. Location Address}}"))!;
    const text = renderTemplate(t, sampleOrder);
    expect(text).toContain("123 Main St");
  });

  it("uses abbreviation when state is unknown", () => {
    const t = TEMPLATES.find((tpl) =>
      tpl.includes("{{2. Location State Name}}"),
    )!;
    const order: MessageOrder = {
      ...sampleOrder,
      location: { ...sampleOrder.location, state: "XX" },
    };
    const text = renderTemplate(t, order);
    expect(text).toContain("XX");
    expect(text).not.toContain("Oregon");
  });

  it("renders full state names for all valid US states", () => {
    const t = TEMPLATES.find((tpl) =>
      tpl.includes("{{2. Location State Name}}"),
    )!;
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
      const text = renderTemplate(t, order);
      expect(text).toContain(full);
    }
  });

  it("handles null restaurant without leftover placeholders", () => {
    for (const t of TEMPLATES) {
      const text = renderTemplate(t, noRestaurantOrder);
      expect(text).not.toContain("{{");
      expect(text).not.toContain("}}");
    }
  });

  it("removes dangling 'from' fragments when restaurant is null", () => {
    for (const t of TEMPLATES) {
      const text = renderTemplate(t, noRestaurantOrder);
      // no "from" hanging at end of line (double-space cleanup) nor a bare
      // "from" followed only by whitespace before punctuation/newline
      expect(/\bfrom\s+$/im.test(text)).toBe(false);
      expect(/\bFROM\s{2,}/.test(text)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// preserveWhitespace (issue #223)
// ---------------------------------------------------------------------------

describe("preserveWhitespace", () => {
  const NBSP = "\u00a0";

  it("converts line-leading spaces to non-breaking spaces", () => {
    expect(preserveWhitespace("  art")).toBe(NBSP + NBSP + "art");
  });

  it("converts runs of 2+ interior spaces to non-breaking spaces", () => {
    expect(preserveWhitespace("a  b")).toBe("a" + NBSP + NBSP + "b");
    expect(preserveWhitespace("a    b")).toBe(
      "a" + NBSP + NBSP + NBSP + NBSP + "b",
    );
  });

  it("leaves single interior spaces as regular spaces", () => {
    expect(preserveWhitespace("a b")).toBe("a b");
  });

  it("strips trailing spaces (platforms trim them anyway)", () => {
    expect(preserveWhitespace("art   \nnext")).toBe("art\nnext");
  });

  it("does not touch non-space whitespace like newlines", () => {
    expect(preserveWhitespace("a\n  b")).toBe("a\n" + NBSP + NBSP + "b");
  });
});

// ---------------------------------------------------------------------------
// renderMessage (random selection)
// ---------------------------------------------------------------------------

describe("renderMessage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders a template chosen at random", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const text1 = renderMessage(sampleOrder);
    jest.spyOn(Math, "random").mockReturnValue(0.9999);
    const text2 = renderMessage(sampleOrder);
    expect(text1).not.toBe(text2);
  });

  it("selects the first template when random = 0", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const text = renderMessage(sampleOrder);
    expect(text).toBe(renderTemplate(TEMPLATES[0], sampleOrder));
  });

  it("selects the last template when random is near 1", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.9999);
    const text = renderMessage(sampleOrder);
    expect(text).toBe(
      renderTemplate(TEMPLATES[TEMPLATES.length - 1], sampleOrder),
    );
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
