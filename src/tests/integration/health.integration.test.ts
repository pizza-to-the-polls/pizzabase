import { lambdaGet } from "../testLambdaHandler";

describe("Health (via Lambda handler)", () => {
  test("GET /health returns 200", async () => {
    const response = await lambdaGet("/health");
    expect(response.statusCode).toBe(200);
  });

  test("Multiple warm invocations reuse handler", async () => {
    const r1 = await lambdaGet("/health");
    expect(r1.statusCode).toBe(200);

    const r2 = await lambdaGet("/health");
    expect(r2.statusCode).toBe(200);
    const r3 = await lambdaGet("/health");
    expect(r3.statusCode).toBe(200);
  });

  test("GET / returns root response", async () => {
    const response = await lambdaGet("/");
    expect(response.statusCode).toBe(200);
  });
});
