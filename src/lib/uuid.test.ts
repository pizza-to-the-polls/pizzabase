import { v4 as uuidv4 } from "uuid";

/**
 * Direct regression test for CJS compatibility of the uuid package.
 *
 * uuid v9+ is ESM-only and would cause Jest (running under ts-jest / CommonJS)
 * to throw "SyntaxError: Unexpected token 'export'" at import time.
 * This test proves we are on a CJS-compatible version (^8.x).
 */
describe("uuid CJS compatibility", () => {
  test("can be imported via ts-jest without ESM errors", () => {
    // If we reached here, the module loaded without a syntax error.
    expect(uuidv4).toBeDefined();
    expect(typeof uuidv4).toBe("function");
  });

  test("v4() returns conformant UUID v4 string", () => {
    const id = uuidv4();
    expect(typeof id).toBe("string");

    // RFC 4122 UUID v4: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
    const uuidv4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidv4Pattern);
  });

  test("v4() generates unique values on consecutive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuidv4()));
    expect(ids.size).toBe(100);
  });

  test("can also be loaded via require() for CommonJS consumers", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const required = require("uuid");
    expect(required.v4).toBeDefined();
    expect(typeof required.v4).toBe("function");
    expect(required.v4()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});
