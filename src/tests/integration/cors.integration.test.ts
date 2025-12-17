import { lambdaGet, lambdaRequest } from "../testLambdaHandler";

describe("CORS (via Lambda handler)", () => {
  beforeAll(() => {
    process.env.ALLOWED_ORIGINS = "polls.pizza";
  });

  test("Access-Control-Allow-Origin header for allowed origin", async () => {
    const response = await lambdaGet("/totals", {
      Origin: "https://polls.pizza",
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.headers["access-control-allow-origin"] ||
        response.headers["Access-Control-Allow-Origin"]
    ).toBe("https://polls.pizza");
  });

  test("OPTIONS /report returns CORS preflight response", async () => {
    const response = await lambdaRequest("OPTIONS", "/report", undefined, {
      Origin: "https://polls.pizza",
      "Access-Control-Request-Method": "POST",
    });

    // Preflight responses from express CORS middleware are status 200,
    // not 204, when optionsSuccessStatus is 200 (which matches our app config)
    expect(response.statusCode).toBe(200);
    expect(
      response.headers["access-control-allow-origin"] ||
        response.headers["Access-Control-Allow-Origin"]
    ).toBe("https://polls.pizza");
  });
});
